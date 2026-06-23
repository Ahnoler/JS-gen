#!/usr/bin/env node
/**
 * Universal Playwright Executor for Claude Code
 *
 * Executes Playwright automation code from:
 * - File path: node run.js script.js
 * - Inline code: node run.js 'await page.goto("...")'
 * - Stdin: cat script.js | node run.js
 *
 * Ensures proper module resolution by running from skill directory.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// Change to skill directory for proper module resolution
process.chdir(__dirname);

/**
 * Known system browser paths to check (Windows)
 */
const BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  `${os.homedir()}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
  `${os.homedir()}\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe`,
];

let EXISTING_BROWSER_PATH = null;

/**
 * Check if Playwright is installed
 */
function checkPlaywrightInstalled() {
  try {
    require.resolve('playwright');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Find an existing Chrome/Edge browser on the system
 */
function findExistingBrowser() {
  for (const p of BROWSER_PATHS) {
    try {
      if (fs.existsSync(p)) {
        console.log(`🔍 发现系统已安装浏览器: ${p}`);
        return p;
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Install Playwright if missing, using existing browser if available
 */
function installPlaywright() {
  console.log('📦 Playwright not found. Installing npm package...');
  try {
    execSync('npm install', { stdio: 'inherit', cwd: __dirname });
    console.log('✅ Playwright npm package installed');

    const existingBrowser = findExistingBrowser();
    if (existingBrowser) {
      EXISTING_BROWSER_PATH = existingBrowser;
      console.log('✅ 使用系统现有浏览器，跳过下载 Chromium');
      return true;
    }

    console.log('🌐 未找到系统浏览器，正在下载 Chromium...');
    execSync('npx playwright install chromium', { stdio: 'inherit', cwd: __dirname });
    console.log('✅ Playwright 及 Chromium 安装成功');
    return true;
  } catch (e) {
    console.error('❌ Failed to install Playwright:', e.message);
    console.error('Please run manually: cd', __dirname, '&& npm run setup');
    return false;
  }
}

/**
 * Get code to execute from various sources
 */
function getCodeToExecute() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    // Case 3: Code from stdin
    if (!process.stdin.isTTY) {
      console.log('📥 Reading from stdin');
      return fs.readFileSync(0, 'utf8');
    }
    console.error('❌ No code to execute');
    console.error('Usage:');
    console.error('  node run.js script.js          # Execute file');
    console.error('  node run.js "code here"        # Execute inline');
    console.error('  cat script.js | node run.js    # Execute from stdin');
    process.exit(1);
  }

  // Reconstruct full input in case path was split by unquoted spaces
  const fullInput = args.join(' ').trim();

  // Case 1: File path provided
  // Try to resolve the file path even if it contains spaces / Chinese chars / special chars
  // Check args[0] first (simple case), then fullInput (path with spaces)
  for (const candidate of [args[0], fullInput]) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) {
        const filePath = path.resolve(candidate);
        console.log(`📄 Executing file: ${filePath}`);
        return fs.readFileSync(filePath, 'utf8');
      }
    } catch (e) {
      // existsSync doesn't throw normally, but chinese chars on windows may cause issues
    }
  }

  // If the input looks like a file path (ends with .js) but file was not found, warn
  if (fullInput.endsWith('.js') && (fullInput.includes(':\\') || fullInput.includes('\\\\'))) {
    console.warn(`⚠️  Input looks like a file path but file was not found: ${fullInput}`);
  }

  // Case 2: Inline code provided as argument
  console.log('⚡ Executing inline code');
  return fullInput;
}

/**
 * Clean up old temporary execution files from previous runs
 */
function cleanupOldTempFiles() {
  try {
    const files = fs.readdirSync(__dirname);
    const tempFiles = files.filter(f => f.startsWith('.temp-execution-') && f.endsWith('.js'));

    if (tempFiles.length > 0) {
      tempFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          // Ignore errors - file might be in use or already deleted
        }
      });
    }
  } catch (e) {
    // Ignore directory read errors
  }
}

/**
 * Wrap code in async IIFE if not already wrapped
 */
function wrapCodeIfNeeded(code) {
  // Check if code already has require() and async structure
  const hasRequire = code.includes('require(');
  const hasAsyncIIFE = code.includes('(async () => {') || code.includes('(async()=>{');

  // If it's already a complete script, return as-is (cleanup handled by generator pipeline)
  if (hasRequire && hasAsyncIIFE) {
    return code;
  }

  // If it's just Playwright commands, wrap in full template
  if (!hasRequire) {
  const browserExecutablePath = EXISTING_BROWSER_PATH;
  return `
const { chromium, firefox, webkit, devices } = require('playwright');
const helpers = require('./lib/helpers');

// Extra headers from environment variables (if configured)
const __extraHeaders = helpers.getExtraHeadersFromEnv();

/**
 * Utility to merge environment headers into context options.
 * Use when creating contexts with raw Playwright API instead of helpers.createContext().
 * @param {Object} options - Context options
 * @returns {Object} Options with extraHTTPHeaders merged in
 */
function getContextOptionsWithHeaders(options = {}) {
  if (!__extraHeaders) return options;
  return {
    ...options,
    extraHTTPHeaders: {
      ...__extraHeaders,
      ...(options.extraHTTPHeaders || {})
    }
  };
}

const __EXISTING_BROWSER = ${browserExecutablePath ? `'${browserExecutablePath.replace(/\\/g, '\\\\')}'` : null};

// Patch chromium.launch to prefer existing system browser
const origLaunch = chromium.launch.bind(chromium);
chromium.launch = async function(opts = {}) {
  if (__EXISTING_BROWSER && !opts.executablePath && !process.env.PLAYWRIGHT_SKIP_EXISTING) {
    opts = { ...opts, executablePath: __EXISTING_BROWSER };
    console.log('🔍 使用系统现有浏览器:', __EXISTING_BROWSER);
  }
  return origLaunch(opts);
};

(async () => {
  try {
    ${code}
  } catch (error) {
    console.error('❌ Automation error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();
`;
  }

  // If has require but no async wrapper
  if (!hasAsyncIIFE) {
  const browserPathForPatch = EXISTING_BROWSER_PATH;
  return `
const __EXISTING_BROWSER = ${browserPathForPatch ? `'${browserPathForPatch.replace(/\\/g, '\\\\')}'` : null};
if (__EXISTING_BROWSER) {
  const { chromium } = require('playwright');
  const origLaunch = chromium.launch.bind(chromium);
  chromium.launch = async function(opts = {}) {
    if (!opts.executablePath) {
      opts = { ...opts, executablePath: __EXISTING_BROWSER };
      console.log('🔍 使用系统现有浏览器:', __EXISTING_BROWSER);
    }
    return origLaunch(opts);
  };
}
(async () => {
  try {
    ${code}
  } catch (error) {
    console.error('❌ Automation error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();
`;
  }

  return code;
}

/**
 * Main execution
 */
async function main() {
  console.log('🎭 Playwright Skill - Universal Executor\n');

  // Clean up old temp files from previous runs
  cleanupOldTempFiles();

  // Check Playwright installation
  if (!checkPlaywrightInstalled()) {
    const installed = installPlaywright();
    if (!installed) {
      process.exit(1);
    }
  }

  // Always check for existing browser (even if playwright is already installed)
  if (!EXISTING_BROWSER_PATH) {
    EXISTING_BROWSER_PATH = findExistingBrowser();
  }

  // Set env var so user scripts can detect existing browser
  if (EXISTING_BROWSER_PATH) {
    process.env.PLAYWRIGHT_BROWSER_PATH = EXISTING_BROWSER_PATH;
  }

  // Get code to execute
  const rawCode = getCodeToExecute();
  const code = wrapCodeIfNeeded(rawCode);

  // Create temporary file for execution
  const tempFile = path.join(__dirname, `.temp-execution-${Date.now()}.js`);

  try {
    // Write code to temp file
    fs.writeFileSync(tempFile, code, 'utf8');

    // Pre-validate JavaScript syntax before execution
    try {
      const vm = require('vm');
      new vm.Script(code, { filename: tempFile });
    } catch (syntaxErr) {
      const lines = code.split('\n');
      const errMsg = syntaxErr.message || '';

      // Extract line:col from error message or stack
      let errLine = 0, errCol = 0;
      // V8 format: "message\n    at new Script (vm.js:...)\n    at ..."
      // Or: "message\n    at ... :line:col"
      const stackMatch = (syntaxErr.stack || '').match(/:(\d+):(\d+)/);
      if (stackMatch) {
        errLine = parseInt(stackMatch[1]) || 0;
        errCol = parseInt(stackMatch[2]) || 0;
      }
      // Also try parsing from the message itself (e.g. "Unexpected token at 581:10")
      if (!errLine) {
        const msgMatch = errMsg.match(/at\s+(\d+):(\d+)/);
        if (msgMatch) { errLine = parseInt(msgMatch[1]) || 0; errCol = parseInt(msgMatch[2]) || 0; }
      }

      console.error('═══════════════════════════════════════════');
      console.error('❌ Script syntax error detected before execution:');
      console.error(`   ${errMsg}`);
      console.error('───────────────────────────────────────────');

      // Show the error location with context
      if (errLine > 0 && errLine <= lines.length) {
        const ctxStart = Math.max(0, errLine - 5);
        const ctxEnd = Math.min(lines.length, errLine + 3);
        console.error(`   📍 Error near line ${errLine}:`);
        if (errCol > 0) {
          console.error(`      Column: ${errCol}`);
        }
        console.error(`   📄 Context (lines ${ctxStart + 1}-${ctxEnd}):`);
        console.error('   ─────────────────────────────────────');
        for (let i = ctxStart; i < ctxEnd; i++) {
          const marker = i === errLine - 1 ? '>>>' : '   ';
          const ln = String(i + 1).padStart(4, ' ');
          const snippet = lines[i].length > 120 ? lines[i].substring(0, 120) + '…' : lines[i];
          console.error(`   ${marker} ${ln} │ ${snippet}`);
        }
        console.error('   ─────────────────────────────────────');
      } else {
        // Can't locate the error — show last few lines as fallback
        console.error('   💡 Could not pinpoint error location. Showing end of file:');
        const tail = lines.slice(Math.max(0, lines.length - 8));
        tail.forEach((l, i) => {
          const ln = String(lines.length - tail.length + i + 1).padStart(4, ' ');
          console.error(`      ${ln} │ ${l.length > 120 ? l.substring(0, 120) + '…' : l}`);
        });
      }

      // Smart hints for common syntax errors
      if (errMsg.includes('Missing catch or finally after try')) {
        console.error('   💡 Hint: A `try {` block is missing its matching `} catch` or `} finally`.');
        if (errLine > 0) {
          // Scan backwards from error line to find unclosed try
          let depth = 0, lastTry = 0;
          for (let i = errLine - 1; i >= 0; i--) {
            const l = lines[i];
            if (/try\s*\{/.test(l)) { depth--; if (depth < 0) { lastTry = i + 1; break; } }
            if (/\}\s*catch/.test(l) || /\}\s*finally/.test(l)) depth++;
          }
          if (lastTry > 0) {
            console.error(`   🔍 Nearest unclosed ` + '`try`' + ` appears to be at line ${lastTry}:`);
            console.error(`      ${lines[lastTry - 1].trim().substring(0, 100)}`);
          }
        }
      } else if (errMsg.includes('Unexpected token')) {
        console.error('   💡 Hint: Check for extra/missing braces, parentheses, or brackets near this line.');
      } else if (errMsg.includes('Unexpected end of input')) {
        console.error('   💡 Hint: The script appears to be truncated — check for missing closing braces.');
      }

      console.error('───────────────────────────────────────────');
      console.error(`   📝 Full script saved at: ${tempFile}`);
      console.error('═══════════════════════════════════════════');
      process.exit(1);
    }

    // Execute the code
    console.log('🚀 Starting automation...\n');
    require(tempFile);

    // Note: Temp file will be cleaned up on next run
    // This allows long-running async operations to complete safely

  } catch (error) {
    console.error('❌ Execution failed:', error.message);
    if (error.stack) {
      console.error('\n📋 Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run main function
main().catch(error => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
