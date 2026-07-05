import { execa } from 'execa';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getReveraDir } from './config.js';
import * as logger from './logger.js';

const SERVICE_NAME = 'revera_github_token';
const ACCOUNT_NAME = 'github';

// ── Windows ─────────────────────────────────────────────────────────────────
// Uses the built-in cmdkey.exe (Windows Credential Manager) for storage.
// Retrieval uses a minimal PowerShell call against CredentialManager WinAPI
// which doesn't require any extra module loading.

async function storeWindows(token: string): Promise<void> {
  // cmdkey /generic:<target> /user:<user> /pass:<password>
  await execa('cmdkey', [`/generic:${SERVICE_NAME}`, `/user:${ACCOUNT_NAME}`, `/pass:${token}`]);
}

async function retrieveWindows(): Promise<string | null> {
  // Use the Windows PowerShell v1 path to avoid PS7 module loading issues
  const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const script = `
    $sig = @"
[DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr credPtr);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr cred);
"@
    $AdvApi = Add-Type -MemberDefinition $sig -Namespace CredHelper -Name Helper -PassThru
    $ptr = [IntPtr]::Zero
    if ($AdvApi::CredRead("${SERVICE_NAME}", 1, 0, [ref]$ptr)) {
      $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [System.Type]::GetType("System.Object"))
      $AdvApi::CredFree($ptr)
    }
    # Simpler approach: use .NET directly
    Add-Type -AssemblyName System.Net
    $wc = New-Object System.Net.WebClient
    try {
      $cm = [Windows.Security.Authentication.Web.Core.WebAuthenticationCoreManager, Windows.Security, ContentType=WindowsRuntime]
    } catch {}
    exit 0
  `;

  // Simpler: just read from the fallback file since cmdkey can't echo passwords
  const securePath = path.join(getReveraDir(), '.token');
  if (fs.existsSync(securePath)) {
    return fs.readFileSync(securePath, 'utf-8').trim();
  }
  return null;
}

async function deleteWindows(): Promise<void> {
  try {
    await execa('cmdkey', [`/delete:${SERVICE_NAME}`]);
  } catch {
    // ignore if not found
  }
  const securePath = path.join(getReveraDir(), '.token');
  if (fs.existsSync(securePath)) fs.unlinkSync(securePath);
}

// ── macOS ────────────────────────────────────────────────────────────────────

async function storeMac(token: string): Promise<void> {
  await execa('security', ['add-generic-password', '-a', ACCOUNT_NAME, '-s', SERVICE_NAME, '-w', token, '-U']);
}

async function retrieveMac(): Promise<string | null> {
  try {
    const { stdout } = await execa('security', ['find-generic-password', '-a', ACCOUNT_NAME, '-s', SERVICE_NAME, '-w']);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function deleteMac(): Promise<void> {
  try {
    await execa('security', ['delete-generic-password', '-a', ACCOUNT_NAME, '-s', SERVICE_NAME]);
  } catch {
    // ignore
  }
}

// ── Linux / fallback ─────────────────────────────────────────────────────────

async function storeLinux(token: string): Promise<void> {
  try {
    await execa(
      'secret-tool',
      ['store', '--label=Revera GitHub Token', 'service', SERVICE_NAME, 'username', ACCOUNT_NAME],
      { input: token },
    );
    return;
  } catch {
    // fall through to file
  }
  storeFile(token);
}

async function retrieveLinux(): Promise<string | null> {
  try {
    const { stdout } = await execa('secret-tool', ['lookup', 'service', SERVICE_NAME, 'username', ACCOUNT_NAME]);
    if (stdout.trim()) return stdout.trim();
  } catch {
    // fall through
  }
  return retrieveFile();
}

async function deleteLinux(): Promise<void> {
  try {
    await execa('secret-tool', ['clear', 'service', SERVICE_NAME, 'username', ACCOUNT_NAME]);
  } catch {
    // ignore
  }
  deleteFile();
}

// ── File fallback (Windows primary retrieval path too) ───────────────────────
// Stored in ~/.revera/.token — same security model as ~/.netrc, git credentials,
// npm auth tokens, and gh CLI tokens on Linux.

function storeFile(token: string): void {
  const securePath = path.join(getReveraDir(), '.token');
  fs.writeFileSync(securePath, token, { encoding: 'utf-8', mode: 0o600 });
}

function retrieveFile(): string | null {
  const securePath = path.join(getReveraDir(), '.token');
  if (!fs.existsSync(securePath)) return null;
  return fs.readFileSync(securePath, 'utf-8').trim();
}

function deleteFile(): void {
  const securePath = path.join(getReveraDir(), '.token');
  if (fs.existsSync(securePath)) fs.unlinkSync(securePath);
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function storeToken(token: string): Promise<void> {
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      // Store in both Credential Manager AND file so retrieval always works
      try {
        await storeWindows(token);
      } catch (e: any) {
        logger.warn(`Credential Manager storage failed (${e.message}), using file fallback`);
      }
      storeFile(token);
      return;
    }
    if (platform === 'darwin') {
      await storeMac(token);
      return;
    }
    await storeLinux(token);
  } catch (err: any) {
    logger.warn(`Keyring storage failed: ${err.message}. Falling back to file.`);
    storeFile(token);
  }
}

export async function retrieveToken(): Promise<string | null> {
  const platform = os.platform();
  try {
    if (platform === 'win32') return retrieveFile();
    if (platform === 'darwin') return await retrieveMac();
    return await retrieveLinux();
  } catch {
    return retrieveFile();
  }
}

export async function deleteToken(): Promise<void> {
  const platform = os.platform();
  if (platform === 'win32') {
    await deleteWindows();
    return;
  }
  if (platform === 'darwin') {
    await deleteMac();
    return;
  }
  await deleteLinux();
}
