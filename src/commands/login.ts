import readline from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { execa } from 'execa';
import { storeToken } from '../utils/keyring.js';
import { theme } from '../ui/theme.js';

// Pre-registered public OAuth Client ID for Aevix CLI
const CLIENT_ID = '178c6fc778ccc68e1d6a';

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function openBrowser(url: string) {
  try {
    const platform = process.platform;
    if (platform === 'win32') {
      await execa('cmd', ['/c', 'start', '""', url]);
    } else if (platform === 'darwin') {
      await execa('open', [url]);
    } else {
      await execa('xdg-open', [url]);
    }
  } catch {
    // Ignore browser failure, user can copy-paste URL
  }
}

export async function handleLogin(): Promise<void> {
  console.log();
  console.log(theme.colors.primary.bold('  ▲ AEVIX GITHUB AUTHENTICATION'));
  console.log(theme.colors.muted('  ' + '─'.repeat(45)));
  console.log('  Authenticate with GitHub to increase API rate limits.');
  console.log();
  console.log('  1. GitHub OAuth2 (Browser Login)');
  console.log('  2. Personal Access Token (Manual)');
  console.log();

  const choice = await promptUser('  Select authentication method [1-2]: ');
  console.log();

  if (choice === '2') {
    // Token Flow
    console.log(chalk.gray('  Generate a token at: https://github.com/settings/tokens'));
    const token = await promptUser('  Enter your GitHub Personal Access Token: ');
    if (!token) {
      console.log(chalk.red('\n  Error: Token cannot be empty.'));
      return;
    }

    const spinner = ora({ text: '  Verifying token authenticity...', indent: 0 }).start();
    try {
      const res = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'aevix-cli/1.0.0'
        }
      });
      spinner.succeed(`  Authenticated as ${chalk.green(res.data.login)}`);
      
      const storeSpinner = ora({ text: '  Storing token...', indent: 0 }).start();
      await storeToken(token);
      storeSpinner.succeed(`  Token saved to ${chalk.dim('~/.aevix/.token')}  (same security model as git credentials)`);
      console.log(chalk.gray('\n  Aevix will now authenticate GitHub API requests at 5,000 req/hour.'));
    } catch (err: any) {
      spinner.fail(`  Authentication failed: ${err.response?.data?.message || err.message}`);
    }
  } else {
    // OAuth2 Device Flow
    const spinner = ora({ text: '  Requesting authorization code from GitHub...', indent: 0 }).start();
    try {
      const res = await axios.post(
        'https://github.com/login/device/code',
        {
          client_id: CLIENT_ID,
          scope: 'public_repo read:user'
        },
        {
          headers: { Accept: 'application/json' }
        }
      );

      const { device_code, user_code, verification_uri, interval, expires_in } = res.data;
      spinner.succeed('  Authorization code requested.');
      console.log();
      console.log(`  1. Please visit: ${chalk.cyan(verification_uri)}`);
      console.log(`  2. Enter code:   ${chalk.white.bold(user_code)}`);
      console.log();
      
      await openBrowser(verification_uri);

      const pollSpinner = ora({ text: '  Waiting for GitHub authorization...', indent: 0 }).start();
      const startTime = Date.now();
      const pollInterval = (interval || 5) * 1000;
      
      const checkAuth = async (): Promise<string | null> => {
        const pollRes = await axios.post(
          'https://github.com/login/oauth/access_token',
          {
            client_id: CLIENT_ID,
            device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          },
          {
            headers: { Accept: 'application/json' }
          }
        );
        
        if (pollRes.data.access_token) {
          return pollRes.data.access_token;
        }
        if (pollRes.data.error === 'authorization_pending') {
          return null;
        }
        if (pollRes.data.error === 'expired_token') {
          throw new Error('Authorization code expired. Please run "aevix login" again.');
        }
        if (pollRes.data.error) {
          throw new Error(pollRes.data.error_description || pollRes.data.error);
        }
        return null;
      };

      while (true) {
        if (Date.now() - startTime > expires_in * 1000) {
          pollSpinner.fail('  Authentication timed out.');
          return;
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
        try {
          const token = await checkAuth();
          if (token) {
            pollSpinner.succeed('  Authorization confirmed!');

            // Verify the token and fetch username
            let username = 'unknown';
            try {
              const userRes = await axios.get('https://api.github.com/user', {
                headers: {
                  Authorization: `token ${token}`,
                  Accept: 'application/vnd.github.v3+json',
                  'User-Agent': 'aevix-cli/1.0.0'
                }
              });
              username = userRes.data.login;
            } catch { /* ignore */ }

            console.log(`  ${theme.colors.success(theme.icons.success)}  Authenticated as ${chalk.green(username)}`);
            const storeSpinner = ora({ text: '  Storing token...', indent: 0 }).start();
            await storeToken(token);
            storeSpinner.succeed(`  Token saved to ${chalk.dim('~/.aevix/.token')}  (same security model as git credentials)`);
            console.log(chalk.gray('\n  Aevix will now authenticate GitHub API requests at 5,000 req/hour.'));
            break;
          }
        } catch (err: any) {
          pollSpinner.fail(`  Authentication failed: ${err.message}`);
          break;
        }
      }
    } catch (err: any) {
      spinner.fail(`  Failed to initiate OAuth flow: ${err.message}`);
    }
  }
  console.log();
}
