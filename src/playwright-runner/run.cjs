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

// Change to skill directory for proper module resolution
process.chdir(__dirname);


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
    const tempFiles = files.filter(f => f.startsWith('.temp-execution-') && f.endsWith('.cjs'));

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
  const hasRequire = code.includes('require(');
  const hasAsyncIIFE = code.includes('(async () => {') || code.includes('(async()=>{');

  // Already complete — run as-is
  if (hasRequire && hasAsyncIIFE) return code;

  // No require — wrap with full Playwright setup
  if (!hasRequire) {
    return `
const { chromium } = require('playwright');
(async () => {
  try {
    ${code}
  } catch (error) {
    console.error('Automation error:', error.message);
    process.exit(1);
  }
})();
`;
  }

  // Has require but no IIFE — wrap with IIFE
  return `
(async () => {
  try {
    ${code}
  } catch (error) {
    console.error('Automation error:', error.message);
    process.exit(1);
  }
})();
`;
}

/**
 * Main execution
 */
async function main() {
  console.log('🎭 Playwright Skill - Universal Executor\n');

  // Clean up old temp files from previous runs
  cleanupOldTempFiles();

  // Playwright is built-in — must be available
  if (!checkPlaywrightInstalled()) {
    console.error('❌ Playwright not found. Run: npm install');
    process.exit(1);
  }

  // Get code to execute
  const rawCode = getCodeToExecute();
  const code = wrapCodeIfNeeded(rawCode);

  // Create temporary file for execution
  const tempFile = path.join(__dirname, `.temp-execution-${Date.now()}.cjs`);

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
