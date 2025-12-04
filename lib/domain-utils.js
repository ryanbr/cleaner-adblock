// === Domain Utility Functions ===

const fs = require('fs');
const path = require('path');

// Load multi-label TLD data
let multiTLDs;
try {
  const tldData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'multi_label_suffixes.json'), 'utf8')
  );
  multiTLDs = new Set(tldData.multi_label_suffixes || []);
} catch (error) {
  console.error(`Warning: Could not load multi-label TLD data: ${error.message}`);
  multiTLDs = new Set(['co.uk', 'com.au', 'com.br', 'co.nz', 'co.za']);
}

// Extract base domain (handles subdomains and multi-label TLDs)
function getBaseDomain(domain) {
  domain = domain.replace(/^www\./, '');
  const parts = domain.split('.');

  if (parts.length <= 2) {
    return domain;
  }

  // Check for multi-label TLDs (longest to shortest)
  for (let tldParts = 3; tldParts >= 2; tldParts--) {
    if (parts.length > tldParts) {
      const suffix = parts.slice(-tldParts).join('.');
      if (multiTLDs.has(suffix)) {
        return parts.slice(-(tldParts + 1)).join('.');
      }
    }
  }

  return parts.slice(-2).join('.');
}

// Check if two domains share the same base domain
function isSimilarDomain(domain1, domain2) {
  return getBaseDomain(domain1) === getBaseDomain(domain2);
}

module.exports = {
  getBaseDomain,
  isSimilarDomain,
  multiTLDs
};