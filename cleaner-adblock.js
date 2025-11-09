// === Minimal Domain Scanner v2.0 ===
// Scans filter lists to find dead domains and redirecting domains
// Outputs to two separate files:
// - dead_domains.txt: Domains that don't resolve (should be removed)
// - redirect_domains.txt: Domains that redirect to different domains (for review)

// Parse command-line arguments FIRST (before requiring modules)
const args = process.argv.slice(2);

// Configuration
const TIMEOUT = 25000; // 25 second timeout for page loads
const FORCE_CLOSE_TIMEOUT = 60000; // 60 second fallback to force-close any tab
const CONCURRENCY = 12; // Number of concurrent checks
const DEAD_DOMAINS_FILE = 'dead_domains.txt';
const REDIRECT_DOMAINS_FILE = 'redirect_domains.txt';

// Custom User Agent - Chrome on Windows
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let INPUT_FILE = 'easylist_specific_hide.txt'; // Default
let ADD_WWW = false; // Default: don't add www
let IGNORE_SIMILAR = false; // Default: don't ignore similar domain redirects

// Debug options
let DEBUG = false; // Enable debug output
let DEBUG_VERBOSE = false; // Extra verbose debug output
let DEBUG_NETWORK = false; // Log network events
let DEBUG_BROWSER = false; // Log browser events
let TEST_MODE = false; // Only test first N domains
let TEST_COUNT = 5; // Number of domains to test in test mode

for (const arg of args) {
  if (arg.startsWith('--input=')) {
    INPUT_FILE = arg.split('=')[1];
  } else if (arg === '--add-www') {
    ADD_WWW = true;
  } else if (arg === '--ignore-similar') {
    IGNORE_SIMILAR = true;
  } else if (arg === '--debug') {
    DEBUG = true;
  } else if (arg === '--debug-verbose') {
    DEBUG = true;
    DEBUG_VERBOSE = true;
  } else if (arg === '--debug-network') {
    DEBUG = true;
    DEBUG_NETWORK = true;
  } else if (arg === '--debug-browser') {
    DEBUG = true;
    DEBUG_BROWSER = true;
  } else if (arg === '--debug-all') {
    DEBUG = true;
    DEBUG_VERBOSE = true;
    DEBUG_NETWORK = true;
    DEBUG_BROWSER = true;
  } else if (arg === '--test-mode') {
    TEST_MODE = true;
  } else if (arg.startsWith('--test-count=')) {
    TEST_COUNT = parseInt(arg.split('=')[1]) || 5;
    TEST_MODE = true;
  }
}

// Show help if requested (before loading heavy modules)
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Minimal Domain Scanner v2.0

Purpose:
  Scans filter lists and separates results into two files:
  1. dead_domains.txt - Domains that don't resolve (remove these)
  2. redirect_domains.txt - Domains that redirect (review these)

Usage:
  node nwss_minimal.js [options]

Options:
  --input=<file>    Input file to scan (default: easylist_specific_hide.txt)
  --add-www         Check both domain.com and www.domain.com for bare domains
  --ignore-similar  Ignore redirects to subdomains of same base domain
  --debug           Enable basic debug output
  --debug-verbose   Enable verbose debug output (includes --debug)
  --debug-network   Enable network request/response logging (includes --debug)
  --debug-browser   Enable browser event logging (includes --debug)
  --debug-all       Enable all debug options
  --test-mode       Only test first 5 domains (for quick testing)
  --test-count=N    Only test first N domains (enables test mode)
  --help, -h        Show this help message

Examples:
  node cleanup-site-debug.js
  node cleanup-site-debug.js --input=my_rules.txt
  node cleanup-site-debug.js --add-www
  node cleanup-site-debug.js --input=my_rules.txt --add-www --ignore-similar
  node cleanup-site-debug.js --debug --test-mode
  node cleanup-site-debug.js --debug-all --test-count=10
  node cleanup-site-debug.js --debug-network

Supported Rule Types:
  Cosmetic/Element Hiding (uBlock Origin):
    domain.com##.selector
    domain.com##+js(scriptlet)
    domain.com#@#.selector
    
  Adguard Rules:
    domain.com##selector (element hiding)
    domain.com#@#selector (exception)
    domain.com#$#selector (CSS injection)
    domain.com#%#//scriptlet(...) (scriptlet)
    domain.com#?#selector (extended CSS)
    domain.com#@$?#selector (extended CSS exception)
    Multiple domains: domain1.com,domain2.com##selector
    
  Network Rules:
    /path$script,domain=example.com
    ||domain.com^$script,domain=site1.com|site2.com
    Extracts domains from domain= parameter

--add-www behavior:
  - domain.com ? checks both domain.com AND www.domain.com
  - If EITHER works, domain is marked as active
  - sub.domain.com ? only checks sub.domain.com (no www added)
  - www.domain.com ? only checks www.domain.com (already has www)
  - Works with both cosmetic and network rules!

--ignore-similar behavior:
  - Skips redirects to subdomains of the same base domain
  - example.com ? sub.example.com (ignored, same base domain)
  - example.com ? different.com (flagged, different domain)
  - Reduces noise from internal subdomain redirects
  - Useful for sites that redirect to CDN/regional subdomains

Dead domains (remove from list):
  - HTTP 404, 410, 5xx errors
  - DNS resolution failures
  - Connection timeouts
  - Network errors

Redirect domains (review):
  - Domains that redirect to different domains
  - May still be valid or may need updating

Configuration:
  - Page load timeout: ${TIMEOUT / 1000}s
  - Force-close timeout: ${FORCE_CLOSE_TIMEOUT / 1000}s
  - Concurrent checks: ${CONCURRENCY}
`);
  process.exit(0);
}

// Now load required modules
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Debug logging functions
function debugLog(message, level = 'DEBUG') {
  if (DEBUG) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] [${level}] ${message}`);
  }
}

function debugVerbose(message) {
  if (DEBUG_VERBOSE) {
    debugLog(message, 'VERBOSE');
  }
}

function debugNetwork(message) {
  if (DEBUG_NETWORK) {
    debugLog(message, 'NETWORK');
  }
}

function debugBrowser(message) {
  if (DEBUG_BROWSER) {
    debugLog(message, 'BROWSER');
  }
}

// Check if domain is valid (not .onion or IP address)
function isValidDomain(domain) {
  // Skip .onion domains (Tor hidden services)
  if (domain.endsWith('.onion')) {
    return false;
  }
  
  // Skip IP addresses (IPv4)
  // Pattern: 0-255.0-255.0-255.0-255
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(domain)) {
    return false;
  }
  
  // Skip IPv6 addresses (simplified check)
  // Contains colons which are not valid in domain names
  if (domain.includes(':')) {
    return false;
  }
  
  // Skip localhost
  if (domain === 'localhost' || domain === '127.0.0.1') {
    return false;
  }
  
  return true;
}

// Safely truncate error message without cutting off mid-word
function truncateError(message, maxLength = 120) {
  if (message.length <= maxLength) {
    return message;
  }
  // Truncate and add ellipsis
  return message.substring(0, maxLength) + '...';
}

// Extract base domain (handles subdomains)
function getBaseDomain(domain) {
  // Remove www. prefix
  domain = domain.replace(/^www\./, '');
  
  // Split by dots
  const parts = domain.split('.');
  
  // For domains like example.com, return as-is
  if (parts.length <= 2) {
    return domain;
  }
  
  // For domains like sub.example.com, return example.com
  // For domains like sub.example.co.uk, return example.co.uk
  // Simple heuristic: take last 2 parts
  return parts.slice(-2).join('.');
}

// Check if redirect is to subdomain of same base domain
function isSimilarDomainRedirect(originalDomain, finalDomain) {
  if (!IGNORE_SIMILAR) {
    return false; // Feature disabled
  }
  
  const originalBase = getBaseDomain(originalDomain);
  const finalBase = getBaseDomain(finalDomain);
  
  // Same base domain = similar redirect
  return originalBase === finalBase;
}

// Extract domains from uBlock Origin and Adguard style rule lines
function extractDomains(line) {
  line = line.trim();
  
  if (!line || line.startsWith('!') || line.startsWith('[')) {
    return [];
  }
  
  const validDomains = [];
  
  // Check for Adguard rules (##, #@#, #$#, #%#, #?#, #@$?#)
  // Examples:
  // domain.com##selector
  // domain.com#@#selector (exception)
  // domain.com#$#selector (CSS injection)
  // domain.com#%#//scriptlet(...)
  // domain.com#?#selector (extended CSS)
  // domain.com#@$?#selector (extended CSS exception)
  // domain1.com,domain2.com##selector (multiple domains)
  const adguardMatch = line.match(/^([^#]+)#[@$%?]*#/);
  if (adguardMatch) {
    const domainPart = adguardMatch[1];
    const domainList = domainPart.split(',').map(d => d.trim());
    
    for (let domain of domainList) {
      // Skip wildcards
      if (domain.includes('*')) {
        continue;
      }
      
      // Remove leading dots or tildes
      domain = domain.replace(/^[.~]+/, '');
      
      // Basic domain validation
      if (domain && domain.includes('.') && domain.length >= 4) {
        // Skip .onion domains and IP addresses
        if (isValidDomain(domain)) {
          validDomains.push(domain);
        }
      }
    }
    
    // Return early for Adguard rules
    if (validDomains.length > 0) {
      return validDomains;
    }
  }
  
  // Check for network rules with domain= parameter
  // Examples: 
  // /path$script,domain=example.com
  // ||domain.com^$script,domain=site1.com|site2.com
  const domainMatch = line.match(/domain=([^,\s$]+)/);
  if (domainMatch) {
    const domainList = domainMatch[1].split('|');
    for (let domain of domainList) {
      domain = domain.trim();
      
      // Skip wildcards
      if (domain.includes('*') || domain.startsWith('~')) {
        continue;
      }
      
      // Remove leading dots
      domain = domain.replace(/^[.]+/, '');
      
      // Basic domain validation
      if (domain && domain.includes('.') && domain.length >= 4) {
        // Skip .onion domains and IP addresses
        if (isValidDomain(domain)) {
          validDomains.push(domain);
        }
      }
    }
    
    // Return early for network rules - don't also try to parse as element hiding
    if (validDomains.length > 0) {
      return validDomains;
    }
  }
  
  // Check for uBlock Origin element hiding/cosmetic rules (##, #@#, etc.)
  const match = line.match(/^([^#\s]+?)(?:##(?:\+js\()?|#@#|##\^)/);
  if (!match) return validDomains; // Return empty or domains from network rules
  
  let domainPart = match[1];
  const domainList = domainPart.split(',').map(d => d.trim());
  
  for (let domain of domainList) {
    // Skip wildcards
    if (domain.includes('*')) {
      continue;
    }
    
    // Remove leading dots or tildes
    domain = domain.replace(/^[.~]+/, '');
    
    // Basic domain validation
    if (domain && domain.includes('.') && domain.length >= 4) {
      // Skip .onion domains and IP addresses
      if (isValidDomain(domain)) {
        validDomains.push(domain);
      }
    }
  }
  
  return validDomains;
}

// Parse input file and extract unique domains
function parseDomainsFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const domains = new Set();
  
  for (const line of lines) {
    const extractedDomains = extractDomains(line);
    for (const domain of extractedDomains) {
      domains.add(domain);
    }
  }
  
  return Array.from(domains).sort();
}

// Check if domain is a bare domain (no subdomain)
function isBareDomain(domain) {
  // Remove www. for checking
  const withoutWww = domain.replace(/^www\./, '');
  // Count dots - bare domains have exactly one dot (e.g., example.com)
  const dotCount = (withoutWww.match(/\./g) || []).length;
  return dotCount === 1;
}

// Expand domains with www variants if --add-www is enabled
function expandDomainsWithWww(domains) {
  if (!ADD_WWW) {
    return domains.map(d => ({ original: d, variants: [d] }));
  }
  
  return domains.map(domain => {
    // If domain already starts with www., don't add variant
    if (domain.startsWith('www.')) {
      return { original: domain, variants: [domain] };
    }
    
    // If domain has subdomain (e.g., sub.example.com), don't add www
    if (!isBareDomain(domain)) {
      return { original: domain, variants: [domain] };
    }
    
    // Bare domain without www - check both variants
    return { 
      original: domain, 
      variants: [domain, `www.${domain}`]
    };
  });
}

// Check if domain is dead or redirecting
// domainObj format: { original: 'domain.com', variants: ['domain.com', 'www.domain.com'] }
async function checkDomain(browser, domainObj, index, total) {
  const { original, variants } = domainObj;
  const domain = original; // Use original for logging
  
  debugVerbose(`Starting check for domain: ${domain} (${index + 1}/${total})`);
  debugVerbose(`Variants to check: ${variants.join(', ')}`);
  
  console.log(`[${index + 1}/${total}] Checking ${domain}...`);
  
  // Try each variant until one succeeds
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const isLastVariant = i === variants.length - 1;
    const variantLabel = variant === original ? '' : ` (trying www.${original})`;
    
    debugVerbose(`Trying variant ${i + 1}/${variants.length}: ${variant}`);
    
    const page = await browser.newPage();
    debugBrowser(`Created new page for ${variant}`);
    
    // Set custom Chrome user agent
    await page.setUserAgent(USER_AGENT);
    debugBrowser(`Set user agent: ${USER_AGENT}`);
    
    // Add network event listeners for debugging
    if (DEBUG_NETWORK) {
      page.on('request', request => {
        debugNetwork(`Request: ${request.method()} ${request.url()}`);
      });
      
      page.on('response', response => {
        debugNetwork(`Response: ${response.status()} ${response.url()}`);
      });
      
      page.on('requestfailed', request => {
        debugNetwork(`Request failed: ${request.url()} - ${request.failure().errorText}`);
      });
    }
    
    let forceCloseTimer = null;
    let pageClosed = false;
    
    const forceClosePage = async () => {
      if (!pageClosed) {
        console.log(`  ? Force-closing ${variant} after ${FORCE_CLOSE_TIMEOUT / 1000}s timeout`);
        pageClosed = true;
        try {
          await page.close();
        } catch (e) {
          // Ignore
        }
      }
    };
    
    forceCloseTimer = setTimeout(forceClosePage, FORCE_CLOSE_TIMEOUT);
    
    try {
      const url = `https://${variant}`;
      if (i === 0) {
        console.log(`[${index + 1}/${total}] Checking ${domain}...${ADD_WWW && variants.length > 1 ? ' (with www fallback)' : ''}`);
      } else {
        console.log(`  ? Trying www.${domain}...`);
      }
      
      let statusCode = null;
      
      page.on('response', response => {
        if (response.url() === url || response.url() === url + '/') {
          statusCode = response.status();
          debugNetwork(`Main response received: ${statusCode} for ${response.url()}`);
        }
      });
      
      debugVerbose(`Attempting to navigate to: ${url}`);
      debugVerbose(`Timeout set to: ${TIMEOUT}ms`);
      
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUT
      });
      
      debugVerbose(`Navigation completed for ${variant}`);
      
      const finalUrl = page.url();
      debugVerbose(`Final URL after navigation: ${finalUrl}`);
      
      if (response) {
        statusCode = response.status();
      }
      
      // Check if dead
      const isDead = statusCode >= 400 || statusCode === null;
      
      // If dead and not last variant, try next variant
      if (isDead && !isLastVariant) {
        clearTimeout(forceCloseTimer);
        if (!pageClosed) {
          pageClosed = true;
          await page.close();
        }
        console.log(`  ??  ${variant} - Dead (HTTP ${statusCode || 'timeout'}), trying next...`);
        continue; // Try next variant
      }
      
      // Check if redirects to different domain
      const extractDomain = (urlStr) => {
        try {
          const parsed = new URL(urlStr);
          return parsed.hostname.replace(/^www\./, '');
        } catch {
          return urlStr;
        }
      };
      
      const originalDomain = extractDomain(url);
      const finalDomain = extractDomain(finalUrl);
      const isRedirecting = originalDomain !== finalDomain && !isDead;
      
      // Check if redirect is to similar domain (subdomain of same base)
      const isSimilarRedirect = isRedirecting && isSimilarDomainRedirect(originalDomain, finalDomain);
      
      let result = { type: null, data: null };
      
      if (isDead) {
        const reason = `HTTP ${statusCode || 'timeout/unreachable'}`;
        console.log(`  ??  ${domain} - Dead (${reason})${variantLabel}`);
        result = { 
          type: 'dead', 
          data: { domain, statusCode, reason }
        };
      } else if (isRedirecting && !isSimilarRedirect) {
        // Only flag as redirect if NOT similar domain
        console.log(`  ?? ${domain} - Redirects to ${finalDomain}${variantLabel}`);
        result = { 
          type: 'redirect', 
          data: { domain, finalDomain, originalUrl: url, finalUrl, statusCode }
        };
      } else {
        // Active or similar domain redirect (treated as active)
        if (isSimilarRedirect) {
          console.log(`  ?  ${domain} - Active (similar redirect: ${finalDomain})${variantLabel}`);
        } else {
          console.log(`  ?  ${domain} - Active (HTTP ${statusCode})${variantLabel}`);
        }
        result = { type: null, data: null };
      }
      
      clearTimeout(forceCloseTimer);
      if (!pageClosed) {
        pageClosed = true;
        await page.close();
        console.log(`  ??  Closed tab for ${variant}`);
      }
      
      return result; // Success - return result
      
    } catch (error) {
      debugVerbose(`Error caught for ${variant}: ${error.message}`);
      debugVerbose(`Error stack: ${error.stack}`);
      
      // Check if error indicates domain is truly dead
      // Exclude certificate errors since we're ignoring them
      const isCertError = error.message.includes('ERR_CERT') || 
                         error.message.includes('SSL') ||
                         error.message.includes('certificate');
      
      debugVerbose(`Is certificate error: ${isCertError}`);
      
      const isDead = !isCertError && (
        error.message.includes('timeout') || 
        error.message.includes('ERR_NAME_NOT_RESOLVED') ||
        error.message.includes('ERR_CONNECTION_REFUSED') ||
        error.message.includes('ERR_CONNECTION_TIMED_OUT') ||
        error.message.includes('ERR_CONNECTION_RESET') ||
        error.message.includes('ERR_ADDRESS_UNREACHABLE')
      );
      
      debugVerbose(`Is dead: ${isDead}, Is last variant: ${isLastVariant}`);
      
      clearTimeout(forceCloseTimer);
      if (!pageClosed) {
        pageClosed = true;
        try {
          await page.close();
        } catch (closeError) {
          // Ignore
        }
      }
      
      // If dead and not last variant, try next variant
      if (isDead && !isLastVariant) {
        const reason = truncateError(error.message);
        console.log(`  ??  ${variant} - Dead (${reason}), trying next...`);
        continue; // Try next variant
      }
      
      // Last variant or non-dead error
      let result = { type: null, data: null };
      
      if (isDead) {
        const reason = truncateError(error.message);
        console.log(`  ??  ${domain} - Dead (${reason})${variantLabel}`);
        result = { 
          type: 'dead', 
          data: { domain, statusCode: null, reason: error.message } // Store full error in data
        };
      } else {
        const reason = truncateError(error.message);
        console.log(`  ?  ${domain} - ${reason}${variantLabel}`);
      }
      
      console.log(`  ??  Closed tab for ${variant}`);
      return result;
    }
  }
  
  // Should never reach here, but return dead as fallback
  return { 
    type: 'dead', 
    data: { domain, statusCode: null, reason: 'All variants failed' }
  };
}

// Process domains with concurrency control
async function processDomains(browser, domainObjects) {
  const results = [];
  const total = domainObjects.length;
  
  debugVerbose(`Starting to process ${total} domains with concurrency ${CONCURRENCY}`);
  
  for (let i = 0; i < domainObjects.length; i += CONCURRENCY) {
    const batch = domainObjects.slice(i, i + CONCURRENCY);
    const batchNumber = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(domainObjects.length / CONCURRENCY);
    
    debugVerbose(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} domains)`);
    
    const batchResults = await Promise.all(
      batch.map((domainObj, batchIndex) => 
        checkDomain(browser, domainObj, i + batchIndex, total)
      )
    );
    
    results.push(...batchResults.filter(r => r !== null && r.type !== null));
    
    // Cleanup: verify all pages are closed after each batch
    const pages = await browser.pages();
    const openPages = pages.length;
    
    debugBrowser(`After batch ${batchNumber}: ${openPages} pages open`);
    
    if (openPages > 1) {
      console.log(`  ??  Cleanup: Found ${openPages - 1} lingering pages, closing...`);
      for (const page of pages) {
        if (page.url() !== 'about:blank') {
          try {
            await page.close();
            debugBrowser(`Closed lingering page: ${page.url()}`);
          } catch (e) {
            debugBrowser(`Failed to close page: ${e.message}`);
          }
        }
      }
    }
    
    debugVerbose(`Batch ${batchNumber} completed`);
  }
  
  debugVerbose(`All batches completed. Total results: ${results.length}`);
  return results;
}

// Write dead domains to file
function writeDeadDomains(deadDomains) {
  const lines = [
    `# Dead/Non-Existent Domains`,
    `# These domains don't resolve and should be removed from filter lists`,
    `# Generated: ${new Date().toISOString()}`,
    `# Total found: ${deadDomains.length}`,
    `#`,
    `# These domains returned errors:`,
    `# - HTTP 404, 410, 5xx (not found/gone/server error)`,
    `# - DNS failures (domain doesn't exist)`,
    `# - Timeouts (unreachable)`,
    `# - Network errors`,
    '',
  ];
  
  for (const item of deadDomains) {
    lines.push(`${item.domain} # ${item.reason}`);
  }
  
  fs.writeFileSync(DEAD_DOMAINS_FILE, lines.join('\n'), 'utf8');
  console.log(`\n? Dead domains written to ${DEAD_DOMAINS_FILE}`);
}

// Write redirect domains to file
function writeRedirectDomains(redirectDomains) {
  const lines = [
    `# Redirecting Domains`,
    `# These domains redirect to different domains - review for updates`,
    `# Generated: ${new Date().toISOString()}`,
    `# Total found: ${redirectDomains.length}`,
    `#`,
    `# Format: original_domain ? final_domain`,
    `# Note: These domains still work, but redirect elsewhere`,
    `# Action: Review if filter rules should be updated`,
    '',
  ];
  
  for (const item of redirectDomains) {
    lines.push(`${item.domain} ? ${item.finalDomain} # ${item.finalUrl}`);
  }
  
  fs.writeFileSync(REDIRECT_DOMAINS_FILE, lines.join('\n'), 'utf8');
  console.log(`? Redirect domains written to ${REDIRECT_DOMAINS_FILE}`);
}

// Main execution
(async () => {
  console.log('=== Minimal Domain Scanner v2.0 ===\n');
  
  console.log(`Input file: ${INPUT_FILE}`);
  if (ADD_WWW) {
    console.log(`--add-www enabled: Will check both domain.com and www.domain.com for bare domains`);
  }
  if (DEBUG) {
    console.log(`Debug mode enabled:`);
    console.log(`  Basic debug: ${DEBUG}`);
    console.log(`  Verbose debug: ${DEBUG_VERBOSE}`);
    console.log(`  Network debug: ${DEBUG_NETWORK}`);
    console.log(`  Browser debug: ${DEBUG_BROWSER}`);
  }
  if (TEST_MODE) {
    console.log(`Test mode enabled: Only checking first ${TEST_COUNT} domains`);
  }
  console.log(`Reading domains from ${INPUT_FILE}...`);
  
  let domains;
  try {
    domains = parseDomainsFromFile(INPUT_FILE);
  } catch (error) {
    console.error(`\n? Error: ${error.message}`);
    console.log(`\nTip: Use --input=<file> to specify a different input file`);
    console.log(`Example: node nwss_minimal.js --input=my_rules.txt\n`);
    process.exit(1);
  }
  
  console.log(`Found ${domains.length} unique domains to check\n`);
  
  // Apply test mode if enabled
  if (TEST_MODE && domains.length > TEST_COUNT) {
    console.log(`TEST MODE: Limiting to first ${TEST_COUNT} domains (from ${domains.length} total)\n`);
    domains = domains.slice(0, TEST_COUNT);
  }
  
  // Expand domains with www variants if --add-www is enabled
  const domainObjects = expandDomainsWithWww(domains);
  const totalChecks = domainObjects.reduce((sum, obj) => sum + obj.variants.length, 0);
  
  if (ADD_WWW) {
    const withWww = domainObjects.filter(obj => obj.variants.length > 1).length;
    console.log(`Expanded to ${totalChecks} total checks (${withWww} domains will try www variant)\n`);
  }
  
  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true, // Ignore SSL/certificate errors
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors', // Additional certificate error ignoring
      '--ignore-certificate-errors-spki-list'
    ]
  });
  
  debugBrowser('Browser launched successfully');
  
  console.log('Browser launched. Starting domain checks...\n');
  
  const results = await processDomains(browser, domainObjects);
  
  await browser.close();
  
  // Separate results by type
  const deadDomains = results.filter(r => r.type === 'dead').map(r => r.data);
  const redirectDomains = results.filter(r => r.type === 'redirect').map(r => r.data);
  
  console.log(`\n=== Summary ===`);
  console.log(`Total domains checked: ${domains.length}`);
  console.log(`Dead/non-existent: ${deadDomains.length}`);
  console.log(`Redirecting: ${redirectDomains.length}`);
  console.log(`Active (no issues): ${domains.length - deadDomains.length - redirectDomains.length}`);
  
  if (deadDomains.length > 0) {
    writeDeadDomains(deadDomains);
    console.log(`\n?? Tip: Remove these ${deadDomains.length} dead domains from your filter list`);
  } else {
    console.log('\n? No dead domains found');
  }
  
  if (redirectDomains.length > 0) {
    writeRedirectDomains(redirectDomains);
    console.log(`\n?? Tip: Review these ${redirectDomains.length} redirecting domains - they may need rule updates`);
  } else {
    console.log('? No redirecting domains found');
  }
  
  process.exit(0);
})();