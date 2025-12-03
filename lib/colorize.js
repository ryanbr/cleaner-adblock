// === Color Utility Module (colorize.js) ===
// Centralized color management for cleaner-adblock.js console output

/**
 * Detects if color output should be enabled based on command line arguments
 * @returns {boolean} True if --color or --colour flag is present
 */
function shouldEnableColors() {
  return process.argv.includes('--color') || process.argv.includes('--colour');
}

// Initialize color support based on command line flags
const enableColors = shouldEnableColors();

/**
 * ANSI color codes object
 * Only contains actual escape sequences if colors are enabled
 */
const colors = {
  // Reset
  reset: enableColors ? '\x1b[0m' : '',
  
  // Standard colors
  red: enableColors ? '\x1b[31m' : '',
  green: enableColors ? '\x1b[32m' : '',
  yellow: enableColors ? '\x1b[33m' : '',
  blue: enableColors ? '\x1b[34m' : '',
  cyan: enableColors ? '\x1b[36m' : '',
  
  // Extended colors
  gray: enableColors ? '\x1b[90m' : '',
  brightCyan: enableColors ? '\x1b[96m' : ''
};

/**
 * Applies color formatting to text if colors are enabled
 * @param {string} text - The text to colorize
 * @param {string} color - The ANSI color code to apply
 * @returns {string} Colored text (or plain text if colors disabled)
 */
function colorize(text, color) {
  return enableColors ? `${color}${text}${colors.reset}` : text;
}

/**
 * Creates a colored tag with consistent formatting
 * @param {string} tag - The tag text (without brackets)
 * @param {string} color - The color to apply
 * @returns {string} Formatted colored tag
 */
function createTag(tag, color) {
  return colorize(`[${tag}]`, color);
}

/**
 * Pre-built tags for cleaner-adblock.js
 */
const tags = {
  // Status tags
  ok: createTag('OK', colors.green),
  dead: createTag('DEAD', colors.red),
  redirect: createTag('REDIRECT', colors.yellow),
  warn: createTag('WARN', colors.yellow),
  error: createTag('ERROR', colors.red),
  
  // Action tags
  retry: createTag('RETRY', colors.cyan),
  timeout: createTag('TIMEOUT', colors.red),
  cleanup: createTag('CLEANUP', colors.gray),
  
  // Info tags
  tip: createTag('TIP', colors.brightCyan),
  saved: createTag('SAVED', colors.green),
  dns: createTag('DNS', colors.blue),
  
  // HTTP status
  '403': createTag('403', colors.yellow)
};

/**
 * Utility function to check if colors are currently enabled
 * @returns {boolean} Current color enable status
 */
function isColorEnabled() {
  return enableColors;
}

module.exports = {
  colorize,
  colors,
  tags,
  createTag,
  isColorEnabled,
  shouldEnableColors
};
