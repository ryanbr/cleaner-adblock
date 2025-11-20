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
let DEAD_DOMAINS_FILE; // Will be set with timestamp in main()
let REDIRECT_DOMAINS_FILE; // Will be set with timestamp in main()

// Ignored Domains - domains to skip checking (add domains that are incorrectly flagged)
// These domains will be completely skipped during scanning
const IGNORED_DOMAINS = [
  // Add domains here that should be ignored, one per line
  // Examples:
  // 'example.com',
  'aliexpress.us',
  'golfdigest.com',
  'm.economictimes.com',
  'twitter.com',
  'testpages.adblockplus.org',
  'all-nettools.com',
  'dailycaller.com',
  'demap.info',
  'medievalists.net',
  'moviesfoundonline.com',
  'g.doubleclick.net',
  'downloads.codefi.re',
  'cdn.ampproject.org',
  'timesofindia.com',
  'yahoo.com'
];

// Custom User Agent - Chrome on Windows
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

let INPUT_FILE = null; // No default - user must specify input file
let ADD_WWW = false; // Default: don't add www
let IGNORE_SIMILAR = false; // Default: don't ignore similar domain redirects
let IGNORE_NAV_TIMEOUT = false; // Default: don't ignore navigation timeouts
let BLOCK_RESOURCES = false; // Default: don't block resources
let SIMPLE_DOMAINS = false; // New option: parse as simple domain list
let CHECK_DIG = false; // Default: don't check DNS A records
let CHECK_DIG_ALWAYS = false; // Default: don't filter dead domains by DNS

// Debug options
let DEBUG = false; // Enable debug output
let DEBUG_VERBOSE = false; // Extra verbose debug output
let DEBUG_NETWORK = false; // Log network events
let DEBUG_BROWSER = false; // Log browser events
let TEST_MODE = false; // Only test first N domains
let TEST_COUNT = 5; // Number of domains to test in test mode

for (const arg of args) {
  if (arg.startsWith('--input=')) {
    INPUT_FILE = arg.split('=')[1] || null;
  } else if (arg === '--add-www') {
    ADD_WWW = true;
  } else if (arg === '--ignore-similar') {
    IGNORE_SIMILAR = true;
  } else if (arg === '--ignore-nav-timeout') {
    IGNORE_NAV_TIMEOUT = true;
  } else if (arg === '--block-resources') {
    BLOCK_RESOURCES = true;
  } else if (arg === '--simple-domains') {
    SIMPLE_DOMAINS = true;
  } else if (arg === '--check-dig') {
    CHECK_DIG = true;
  } else if (arg === '--check-dig-always') {
    CHECK_DIG_ALWAYS = true;
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
    const parsed = parseInt(arg.split('=')[1], 10);
    TEST_COUNT = Math.max(1, isNaN(parsed) ? 5 : parsed);
    TEST_MODE = true;
  }
}

// Show help if requested (before loading heavy modules)
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Minimal Domain Scanner v2.0

Scans filter lists to find dead/redirecting domains.

Usage:
  node cleaner-adblock.js --input=<file> [options]

Options:
  --input=<file>        Input file to scan (REQUIRED)
  --add-www             Check both bare domain and www variant
  --ignore-similar      Skip redirects to same base domain
  --block-resources     Block images/CSS/fonts for faster scans
  --simple-domains      Parse as plain domain list (one per line)
  --check-dig           Verify dead domains with DNS lookup
  --check-dig-always    Only report domains with no DNS A records
  --debug               Enable basic debug output
  --debug-verbose       Verbose debug output
  --debug-network       Log network requests
  --debug-browser       Log browser events
  --debug-all           Enable all debug options
  --test-mode           Test first 5 domains only
  --test-count=N        Test first N domains
  -h, --help            Show this help

Output Files:
  dead_domains_TIMESTAMP.txt      - Domains that don't resolve (remove these)
  redirect_domains_TIMESTAMP.txt  - Domains that redirect (review these)

Configuration:
  Timeout: ${TIMEOUT / 1000}s | Concurrency: ${CONCURRENCY} | Ignored domains: ${IGNORED_DOMAINS.length}
  Edit IGNORED_DOMAINS array in script to skip specific domains.
`);
  process.exit(0);
}

const { execSync } = require('child_process');
// Now load required modules
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// load multi-label TLD data from multi_label_suffixes.json
let multiTLDs;
try {
  const tldData = JSON.parse(
    fs.readFileSync(path.join(__dirname, "multi_label_suffixes.json"), "utf8")
  );
  multiTLDs = new Set(tldData.multi_label_suffixes || []);
} catch (error) {
  console.error(`Warning: Could not load multi-label TLD data: ${error.message}`);
  console.error('Using fallback set of common multi-label TLDs');
  // Fallback to common multi-label TLDs
  multiTLDs = new Set(['co.uk', 'com.nz', 'com.au', 'co.za', 'com.br']);
}

const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
const domainCharPattern = /^[a-z0-9.-]+$/;

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

// check if a domain is valid
function isValidDomain(domain) {
  if (!domain) return false;
  
  if (!domain.includes('.')) return false; // blocks "abc123" and "localhost"
  if (domain.includes(':')) return false; // ipv6-like (contains :)
  
  const lower = domain.toLowerCase();
  
  if (lower.endsWith('.onion')) return false; // .onion domains
  if (ipv4Pattern.test(lower)) return false; // ipv4
  if (!domainCharPattern.test(lower)) return false; // non-domain-safe characters

  return true;
}


function truncateError(message, maxLength = 120) {
  // validate and sanitise inputs
  const msg = String(message || 'Unknown error');
  const parsedLength = Math.floor(Number(maxLength));
  const safeMaxLength = isNaN(parsedLength) || parsedLength <= 0 ? 120 : parsedLength;

  if (msg.length <= safeMaxLength) return msg;
  // truncate and add ellipsis (total length = maxLength inc. "...")
  return msg.substring(0, safeMaxLength - 3) + '...';
}

// Extract base domain (handles subdomains and multi-label TLDs)
function getBaseDomain(domain) {
  // Remove www. prefix
  domain = domain.replace(/^www\./, '');

  // Split by dots
  const parts = domain.split('.');

  // For domains like example.com, return as-is
  if (parts.length <= 2) {
    return domain;
  }

  // Check for multi-label TLDs (check from longest to shortest)
  // Support up to 3-part TLDs (most are 2-part like co.uk)
  for (let tldParts = 3; tldParts >= 2; tldParts--) {
    if (parts.length > tldParts) {
      const suffix = parts.slice(-tldParts).join('.');
      if (multiTLDs.has(suffix)) {
        // Return domain name + TLD (e.g., example.co.uk)
        return parts.slice(-(tldParts + 1)).join('.');
      }
    }
  }

  // Standard TLD (e.g., .com, .org) - return last 2 parts
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

// Parse simple domain list format
function parseSimpleDomains(line) {
  line = line.trim();
  
  // Skip empty lines and comments
  if (!line || line.startsWith('#') || line.startsWith('!') || line.startsWith('//')) {
    return [];
  }
  
  const validDomains = [];
  
  // Split by comma to handle comma-separated domains
  const domainCandidates = line.split(',').map(d => d.trim());
  
  for (let domain of domainCandidates) {
    // Skip empty entries
    if (!domain) continue;
    
    // Remove protocol if present
    domain = domain.replace(/^https?:\/\//, '');
    
    // Remove path if present (everything after first /)
    domain = domain.split('/')[0];
    
    // Remove port if present
    domain = domain.split(':')[0];
    
    // Basic validation and cleanup
    if (domain && isValidDomain(domain)) {
      validDomains.push(domain.toLowerCase());
    }
  }
  
  return validDomains;
}

// Extract domains from uBlock Origin and Adguard style rule lines
function extractDomains(line) {
  line = line.trim();
  
  if (!line || line.startsWith('!') || line.startsWith('[')) {
    return [];
  }
  
  const validDomains = [];
  
  // Check for Adguard rules (##, #@#, #$#, #%#, #?#, #@$?#, $$)
  // Examples:
  // domain.com##selector
  // domain.com#@#selector (exception)
  // domain.com#$#selector (CSS injection)
  // domain.com#%#//scriptlet(...)
  // domain.com#?#selector (extended CSS)
  // domain.com#@$?#selector (extended CSS exception)
  // domain.com$$script[...] (HTML filtering)
  // domain1.com,domain2.com##selector (multiple domains)
  const adguardMatch = line.match(/^([^#$]+)(?:#[@$%?]*#|\$\$)/);
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
  }
  
  // Extract domain from network rule format (||domain.com^ or ||domain.com/)
  if (line.includes('||')) {
    const networkMatch = line.match(/\|\|([a-z0-9.-]+)/i);
    if (networkMatch) {
      const domain = networkMatch[1];
      
      // Skip wildcards
      if (!domain.includes('*') && isValidDomain(domain)) {
        validDomains.push(domain);
      }
    }
  }
  
  // Return early for network rules if we found any domains
  if (validDomains.length > 0) {
    return validDomains;
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
    let extractedDomains;
    
    // Use simple domain parsing if --simple-domains flag is set
    if (SIMPLE_DOMAINS) {
      extractedDomains = parseSimpleDomains(line);
    } else {
      extractedDomains = extractDomains(line);
    }

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

// Check DNS A record for domain using dig
async function checkDNSRecord(domain) {
  try {
    // Try both www and non-www variants
    const variants = domain.startsWith('www.') 
      ? [domain, domain.replace(/^www\./, '')]
      : [domain, `www.${domain}`];
    
    for (const variant of variants) {
      try {
        const result = execSync(`dig +short A ${variant}`, { 
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'ignore'] // Suppress stderr
        }).trim();
        
        if (result) {
          // Filter out non-IP responses (sometimes dig returns CNAME or other records)
          const ips = result.split('\n').filter(line => {
            // Check if line looks like an IPv4 address
            return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(line.trim());
          });
          
          if (ips.length > 0) {
            return {
              hasRecord: true,
              variant: variant,
              ips: ips
            };
          }
        }
      } catch (err) {
        // Try next variant
        continue;
      }
    }
    
    return { hasRecord: false, variant: null, ips: [] };
  } catch (error) {
    debugVerbose(`DNS check error for ${domain}: ${error.message}`);
    return { hasRecord: false, variant: null, ips: [] };
  }
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

    // Block unnecessary resources if flag is enabled
    if (BLOCK_RESOURCES) {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
          request.abort();
        } else {
          request.continue();
        }
      });
      debugBrowser(`Resource blocking enabled for ${variant}`);
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

      // add network event listeners for debugging
      if (DEBUG_NETWORK) {
        page.on('request', request => {
          debugNetwork(`Request: ${request.method()} ${request.url()}`);
        });

        page.on('requestfailed', request => {
          debugNetwork(`Request failed: ${request.url()} - ${request.failure().errorText}`);
        });
      }

      // single consolidated response listener
      page.on('response', response => {
        const responseUrl = response.url();
        const isMainResponse = responseUrl === url || responseUrl === url + '/';

        if (isMainResponse) {
          statusCode = response.status();
          debugNetwork(`Main response received: ${statusCode} for ${responseUrl}`);
        } else if (DEBUG_NETWORK) {
          debugNetwork(`Response: ${response.status()} ${responseUrl}`);
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

      // Check if page actually loaded with content
      // Even if status is 403, if page loaded content it's likely alive (Cloudflare, auth, etc.)
      const pageContent = await page.content();
      const hasContent = pageContent.length > 500; // Reasonable threshold for actual content
      const notErrorPage = !finalUrl.includes('about:blank');
      const pageActuallyLoaded = hasContent && notErrorPage;
      
      debugVerbose(`Page content length: ${pageContent.length} bytes`);
      debugVerbose(`Has content: ${hasContent}, Not error page: ${notErrorPage}`);

      // Check if this is an anti-bot 403 message that should be ignored
      const isAntiBotMessage = pageContent.includes('Access Denied') && 
        (pageContent.includes("You don't have permission to access") ||
         pageContent.includes('Reference #') ||
         pageContent.includes('errors.edgesuite.net') ||
         finalUrl.includes('errors.edgesuite.net'));
      
      debugVerbose(`Anti-bot 403 detection: ${isAntiBotMessage}`);

      // Check if dead
      // 403 is special - it means server is up but denying access
      // Don't treat 403 as dead if we have www variant to try OR if it's an anti-bot message
      const is403 = statusCode === 403;
      const isTrulyDead = (statusCode >= 400 && statusCode !== 403) || statusCode === null;

      // If 403 but page actually loaded with content, treat as active (Cloudflare, auth walls, etc.)
      if (is403 && pageActuallyLoaded) {
        clearTimeout(forceCloseTimer);
        if (!pageClosed) {
          pageClosed = true;
          await page.close();
        }
        console.log(`  ✓  ${domain} - Active (HTTP 403 but content loaded)${variantLabel}`);
        return { type: null, data: null };
      }

      // If this is an anti-bot 403 message, treat as active (domain is working, just blocking bots)
      if (is403 && isAntiBotMessage) {
        clearTimeout(forceCloseTimer);
        if (!pageClosed) {
          pageClosed = true;
          await page.close();
        }
        console.log(`  ?  ${domain} - Active (HTTP 403 anti-bot protection detected)${variantLabel}`);
        return { type: null, data: null };
      }

      // If 403 and not last variant, try next variant (www might work)
      if (is403 && !isLastVariant) {
        clearTimeout(forceCloseTimer);
        if (!pageClosed) {
          pageClosed = true;
          await page.close();
        }
        console.log(`  ⚠  ${variant} - HTTP 403 Forbidden, trying next...`);
        continue; // Try next variant
      }
      
      // If truly dead and not last variant, try next variant
      if (isTrulyDead && !isLastVariant) {
        clearTimeout(forceCloseTimer);
        if (!pageClosed) {
          pageClosed = true;
          await page.close();
        }
        console.log(`  ??  ${variant} - Dead (HTTP ${statusCode || 'timeout'}), trying next...`);
        continue; // Try next variant
      }
      
      const isDead = isTrulyDead || (is403 && isLastVariant);
      
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
      
      // Check if this is a navigation timeout (not a real connection issue)
      const isNavTimeout = error.message.includes('Navigation timeout of');
      
      const isDead = !isCertError && !isNavTimeout && (
      //const isDead = !isCertError && !(IGNORE_NAV_TIMEOUT && isNavTimeout) && (
        error.message.includes('timeout') || 
        error.message.includes('ERR_NAME_NOT_RESOLVED') ||
        error.message.includes('ERR_CONNECTION_REFUSED') ||
        error.message.includes('ERR_CONNECTION_TIMED_OUT') ||
        error.message.includes('ERR_CONNECTION_RESET') ||
        error.message.includes('ERR_ADDRESS_UNREACHABLE')
      );
      
      debugVerbose(`Is dead: ${isDead}, Is last variant: ${isLastVariant}`);
      
      clearTimeout(forceCloseTimer);
      // Ensure page is always closed, even on errors
      if (!pageClosed && page && !page.isClosed()) {
        pageClosed = true;
        try {
          await page.close();
          debugBrowser(`Page closed for ${variant} after error`);
        } catch (closeError) {
          debugBrowser(`Failed to close page for ${variant}: ${closeError.message}`);
          // Force close if normal close fails
          page.close().catch(() => {});
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
          data: { domain, reason }
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
function writeDeadDomains(deadDomains, scanTimestamp, inputFile) {
  const lines = [
    `# Dead/Non-Existent Domains`,
    `# These domains don't resolve and should be removed from filter lists`,
    `# Scanned file: ${inputFile}`,
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
    let line = `${item.domain} # ${item.reason}`;
    
    // Add DNS info if available
    if (item.dnsInfo && item.dnsInfo.hasRecord) {
      line += ` | DNS: ${item.dnsInfo.variant} -> ${item.dnsInfo.ips.join(', ')}`;
    } else if (item.dnsInfo && !item.dnsInfo.hasRecord) {
      line += ` | DNS: No A record`;
    }
    
    lines.push(line);
  }

  try {
    fs.writeFileSync(DEAD_DOMAINS_FILE, lines.join('\n'), 'utf8');
    console.log(`\n? Dead domains written to ${DEAD_DOMAINS_FILE}`);
  } catch (error) {
    console.error(`\n✗ Error writing to ${DEAD_DOMAINS_FILE}: ${error.message}`);
    process.exit(1);
  }
}

// Write redirect domains to file
function writeRedirectDomains(redirectDomains, scanTimestamp, inputFile) {
  const lines = [
    `# Redirecting Domains`,
    `# These domains redirect to different domains - review for updates`,
    `# Scanned file: ${inputFile}`,
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

  try {
    fs.writeFileSync(REDIRECT_DOMAINS_FILE, lines.join('\n'), 'utf8');
    console.log(`? Redirect domains written to ${REDIRECT_DOMAINS_FILE}`);
  } catch (error) {
    console.error(`\n✗ Error writing to ${REDIRECT_DOMAINS_FILE}: ${error.message}`);
    process.exit(1);
  }
}

// Main execution
(async () => {
  console.log('=== Minimal Domain Scanner v2.0 ===\n');
  
  // Generate timestamp once for consistent dating across both files
  const SCAN_TIMESTAMP = new Date().toISOString();
  const FILENAME_TIMESTAMP = SCAN_TIMESTAMP.replace(/:/g, '-').replace(/\..+/, ''); // 2024-11-19T12-34-56
  
  // Set filenames with timestamp
  DEAD_DOMAINS_FILE = `dead_domains_${FILENAME_TIMESTAMP}.txt`;
  REDIRECT_DOMAINS_FILE = `redirect_domains_${FILENAME_TIMESTAMP}.txt`;
  
  console.log(`Output files will be:`);
  console.log(`  Dead domains: ${DEAD_DOMAINS_FILE}`);
  console.log(`  Redirect domains: ${REDIRECT_DOMAINS_FILE}\n`);

  // Check if input file is specified
  if (!INPUT_FILE) {
    console.error('? Error: No input file specified');
    console.log('Usage: node cleaner-adblock.js --input=<file>');
    console.log('Example: node cleaner-adblock.js --input=my_rules.txt');
    console.log('Example: node cleaner-adblock.js --input=domains.txt --simple-domains');
    console.log('\nUse --help for more information.\n');
    process.exit(1);
  }
  
  console.log(`Input file: ${INPUT_FILE}`);
  if (SIMPLE_DOMAINS) {
    console.log(`--simple-domains enabled: Parsing as simple domain list`);
  }
  if (CHECK_DIG_ALWAYS) {
    console.log(`--check-dig-always enabled: Only reporting domains with NO DNS A records`);
  }
  if (ADD_WWW) {
    console.log(`--add-www enabled: Will check both domain.com and www.domain.com for bare domains`);
  }
  if (BLOCK_RESOURCES) {
    console.log(`--block-resources enabled: Blocking images/CSS/fonts/media for faster loading and less memory usage`);
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
    console.error(`\n✗ Error: ${error.message}`);
    console.log(`\nPlease check that the file '${INPUT_FILE}' exists and is readable.\n`);
    process.exit(1);
  }
  
  console.log(`Found ${domains.length} unique domains to check\n`);
  
  // Filter out ignored domains
  if (IGNORED_DOMAINS.length > 0) {
    const beforeCount = domains.length;
    domains = domains.filter(domain => !IGNORED_DOMAINS.includes(domain));
    const ignoredCount = beforeCount - domains.length;
    if (ignoredCount > 0) {
      console.log(`Ignored ${ignoredCount} domain(s) from IGNORED_DOMAINS list`);
      if (DEBUG) {
        const ignored = IGNORED_DOMAINS.filter(d => beforeCount > domains.length);
        console.log(`Ignored domains: ${ignored.join(', ')}`);
      }
      console.log(`Remaining domains to check: ${domains.length}\n`);
    }
  }
  
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
    headless: "new",
    ignoreHTTPSErrors: true, // Ignore SSL/certificate errors
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--memory-pressure-off',
      '--ignore-certificate-errors', // Additional certificate error ignoring
      '--ignore-certificate-errors-spki-list'
    ]
  });

  // validate browser launched successfully
  if (!browser || typeof browser.newPage !== 'function') {
    console.error('\n✗ Error: failed to launch browser.');
    process.exit(1);
  }

  debugBrowser('Browser launched successfully');

  console.log('Browser launched. Starting domain checks...\n');
  
  const results = await processDomains(browser, domainObjects);
  
  // Ensure browser closes properly
  try {
    await browser.close();
    debugBrowser('Browser closed successfully');
  } catch (error) {
    console.error(`Warning: Error closing browser: ${error.message}`);
    // Force exit if browser won't close within 5 seconds
    setTimeout(() => process.exit(1), 5000);
  }
  
  // Separate results by type
  const deadDomains = results.filter(r => r.type === 'dead').map(r => r.data);
  const redirectDomains = results.filter(r => r.type === 'redirect').map(r => r.data);
  
  // Batch DNS checks for all dead domains (if enabled)
  if ((CHECK_DIG || CHECK_DIG_ALWAYS) && deadDomains.length > 0) {
    // Only check DNS for connection errors (not HTTP errors like 404)
    const domainsToCheck = deadDomains.filter(item => 
      !item.statusCode || item.reason.includes('ERR_') || item.reason.includes('timeout')
    );
    console.log(`\n?? Running DNS checks on ${domainsToCheck.length} dead domains in parallel...`);
    
    const dnsChecks = await Promise.all(
      domainsToCheck.map(async (item) => {
        const dnsCheck = await checkDNSRecord(item.domain);
        return { domain: item.domain, dnsInfo: dnsCheck };
      })
    );
    
    // Create a map for quick lookup
    const dnsMap = new Map(dnsChecks.map(check => [check.domain, check.dnsInfo]));
    
    // Add DNS info to each dead domain
    for (const item of deadDomains) {
      item.dnsInfo = dnsMap.get(item.domain);
    }
    
    // If --check-dig-always, filter out domains with DNS records
    if (CHECK_DIG_ALWAYS) {
      const beforeCount = deadDomains.length;
      const filteredDomains = deadDomains.filter(item => !item.dnsInfo.hasRecord);
      const removedCount = beforeCount - filteredDomains.length;
      
      if (removedCount > 0) {
        console.log(`? Filtered out ${removedCount} domain(s) with valid DNS A records`);
      }
      
      // Replace deadDomains array
      deadDomains.length = 0;
      deadDomains.push(...filteredDomains);
   }
    
    console.log(`? DNS checks completed\n`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total domains checked: ${domains.length}`);
  console.log(`Dead/non-existent: ${deadDomains.length}`);
  console.log(`Redirecting: ${redirectDomains.length}`);
  console.log(`Active (no issues): ${domains.length - deadDomains.length - redirectDomains.length}`);
  
  if (deadDomains.length > 0) {
    writeDeadDomains(deadDomains, SCAN_TIMESTAMP, INPUT_FILE);
    console.log(`\n?? Tip: Remove these ${deadDomains.length} dead domains from your filter list`);
  } else {
    console.log('\n? No dead domains found');
  }
  
  if (redirectDomains.length > 0) {
    writeRedirectDomains(redirectDomains, SCAN_TIMESTAMP, INPUT_FILE);
    console.log(`\n?? Tip: Review these ${redirectDomains.length} redirecting domains - they may need rule updates`);
  } else {
    console.log('? No redirecting domains found');
  }
  
  process.exit(0);
})();
