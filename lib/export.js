// === Export Module for Adblock Filter Lists ===
// Removes dead and redirected domains from filter lists

const fs = require('fs');
const path = require('path');
const { isSimilarDomain } = require('./domain-utils.js');

// Extract all domains from a filter rule line
function extractDomainsFromLine(line) {
  const domains = new Set();
  
  // Skip comments and empty lines
  if (!line.trim() || line.trim().startsWith('!') || line.trim().startsWith('[')) {
    return domains;
  }
  
  // Check for cosmetic/element hiding rules (##, #@#, #$#, #%#, #?#, $$)
  const cosmeticMatch = line.match(/^([^#$]+)(?:#[@$%?]*#|\$\$)/);
  if (cosmeticMatch) {
    const domainPart = cosmeticMatch[1];
    const domainList = domainPart.split(',').map(d => d.trim());
    
    for (let domain of domainList) {
      // Remove leading dots, tildes, negation
      domain = domain.replace(/^[.~]+/, '');
      
      // Skip wildcards
      if (domain.includes('*')) {
        continue;
      }
      
      if (domain && domain.includes('.')) {
        domains.add(domain.toLowerCase());
      }
    }
  }
  
  // Check for network rules with domain= parameter
  const domainMatch = line.match(/domain=([^,\s$]+)/);
  if (domainMatch) {
    const domainList = domainMatch[1].split('|');
    for (let domain of domainList) {
      domain = domain.trim().replace(/^[.~]+/, '');
      if (domain && !domain.includes('*') && domain.includes('.')) {
        domains.add(domain.toLowerCase());
      }
    }
  }
  
  // Check for || network rules
  if (line.includes('||')) {
    const networkMatch = line.match(/\|\|([a-z0-9.-]+)/i);
    if (networkMatch) {
      const domain = networkMatch[1];
      if (!domain.includes('*') && domain.includes('.')) {
        domains.add(domain.toLowerCase());
      }
    }
  }
  
  return domains;
}

// Remove dead domains from domain= parameter in a line
function cleanDomainParameter(line, domainsToRemove, networkDomainDead = false) {
  // Check if line has domain= parameter
  if (!line.includes('domain=')) {
    return line;
  }
  
  const domainMatch = line.match(/domain=([^,\s$]+)/);
  if (!domainMatch) {
    return line;
  }
  
  const domainParam = domainMatch[1];
  const domainList = domainParam.split('|');
  
  // Filter out dead domains
  const cleanedDomains = domainList.filter(domain => {
    const cleanDomain = domain.trim().replace(/^[.~]+/, '').toLowerCase();
    // Keep wildcards - they can't be checked
    if (cleanDomain.includes('*')) {
      return true;
    }
    return !domainsToRemove.has(cleanDomain);
  });
  
  // If all domains removed, only remove line if network domain is also dead
  if (cleanedDomains.length === 0) {
    // If there's a || domain that's still alive, keep the line
    // Otherwise remove (no || domain, or || domain is also dead)
    const hasNetworkDomain = line.includes('||');
    if (hasNetworkDomain && !networkDomainDead) {
      return line; // Keep - || domain is alive
    }
    return null; // Remove
  }
  
  // If no change, return original line
  if (cleanedDomains.length === domainList.length) {
    return line;
  }
  
  // Replace domain= parameter with cleaned version
  const newDomainParam = cleanedDomains.join('|');
  const newLine = line.replace(/domain=[^,\s$]+/, `domain=${newDomainParam}`);
  
  return newLine;
}

// Remove dead domains from cosmetic rule domain list
function cleanCosmeticDomains(line, domainsToRemove) {
  // Check for cosmetic rules
  const cosmeticMatch = line.match(/^([^#$]+)((?:#[@$%?]*#|\$\$).*)$/);
  if (!cosmeticMatch) {
    return line;
  }
  
  const domainPart = cosmeticMatch[1];
  const rulePart = cosmeticMatch[2];
  const domainList = domainPart.split(',').map(d => d.trim());
  
  // Filter out dead domains
  const cleanedDomains = domainList.filter(domain => {
    const cleanDomain = domain.replace(/^[.~]+/, '').toLowerCase();
    // Skip wildcards
    if (cleanDomain.includes('*')) {
      return true;
    }
    return !domainsToRemove.has(cleanDomain);
  });
  
  // If all domains removed, return null (remove entire line)
  if (cleanedDomains.length === 0) {
    return null;
  }
  
  return cleanedDomains.join(',') + rulePart;
}

// Export cleaned filter list
function exportCleanedList(inputFile, deadDomains, redirectDomains, ignoreSimilar = false) {
  console.log(`\n=== Exporting Cleaned Filter List ===`);
  
  // Create set of domains to remove (dead domains + redirect domains)
  const domainsToRemove = new Set(deadDomains.map(d => d.domain.toLowerCase()));
  // Add redirect domains to removal set, respecting --ignore-similar
  if (redirectDomains && redirectDomains.length > 0) {
    // Filter out similar-domain redirects if --ignore-similar is enabled
    // e.g., domain.com -> en.domain.com would be kept
    const redirectsToRemove = ignoreSimilar
      ? redirectDomains.filter(r => !isSimilarDomain(r.domain, r.finalDomain))
      : redirectDomains;

    for (const redirect of redirectsToRemove) {
      domainsToRemove.add(redirect.domain.toLowerCase());
    }
    
    console.log(`Dead domains to remove: ${deadDomains.length}`);
    console.log(`Redirect domains to remove: ${redirectsToRemove.length}${ignoreSimilar ? ' (ignoring similar-domain redirects)' : ''}`);
    console.log(`Total domains to remove: ${domainsToRemove.size}`);
  } else {
    console.log(`Domains to remove: ${domainsToRemove.size} (dead only)`);
  } 
  
  // Read input file
  let inputContent;
  try {
    inputContent = fs.readFileSync(inputFile, 'utf8');
  } catch (error) {
    console.error(`Error reading input file: ${error.message}`);
    return null;
  }
  const inputLines = inputContent.split('\n');
  
  // Process lines
  const outputLines = [];
  let removedCount = 0;
  let modifiedCount = 0;
  
  for (const line of inputLines) {
    // Skip comments and empty lines - keep as-is
    if (!line.trim() || line.trim().startsWith('!') || line.trim().startsWith('[')) {
      outputLines.push(line);
      continue;
    }
    
    let processedLine = line;
    let wasModified = false;
    let hasDomainParam = false;

    // Try to clean domain= parameters first
    if (line.includes('domain=')) {
      // Check if the || network domain (if any) is also dead
      let networkDomainDead = false;
      if (line.includes('||')) {
        const networkMatch = line.match(/\|\|([a-z0-9.-]+)/i);
        if (networkMatch && domainsToRemove.has(networkMatch[1].toLowerCase())) {
          networkDomainDead = true;
        }
      }
      processedLine = cleanDomainParameter(processedLine, domainsToRemove, networkDomainDead);
      if (processedLine === null) {
        removedCount++;
        continue;
      }
      if (processedLine !== line) {
        wasModified = true;
      }
      hasDomainParam = true;
    }
    
    // Try to clean cosmetic domain lists
    if (processedLine.match(/^([^#$]+)(?:#[@$%?]*#|\$\$)/)) {
      const cosmeticCleaned = cleanCosmeticDomains(processedLine, domainsToRemove);
      if (cosmeticCleaned === null) {
        removedCount++;
        continue;
      }
      if (cosmeticCleaned !== processedLine) {
        wasModified = true;
      }
      processedLine = cosmeticCleaned;
    }
    
    // Track modification once per line
    if (wasModified) {
      modifiedCount++;
    }
    
   // Check if line still contains dead domains in || rules
    // Skip this check for lines with domain= parameter (already handled)
    let hasDeadDomain = false;
    if (!hasDomainParam) {
      const lineDomains = extractDomainsFromLine(processedLine);
      for (const domain of lineDomains) {
      if (domainsToRemove.has(domain)) {
        hasDeadDomain = true;
        break;
      }
     }
    }
    
    if (hasDeadDomain) {
      removedCount++;
    } else {
      outputLines.push(processedLine);
    }
  }
  
  
  const outputFile = inputFile.replace(/\.txt$/, '_cleaned.txt');
  const finalOutput = outputLines.join('\n');
  
  try {
    fs.writeFileSync(outputFile, finalOutput, 'utf8');
  } catch (error) {
    console.error(`Error writing output file: ${error.message}`);
    return null;
  }

  console.log(`Cleaned filter list: ${outputFile}`);
  console.log(`  Removed: ${removedCount} lines`);
  console.log(`  Modified: ${modifiedCount} lines`);
  console.log(`  Kept: ${outputLines.length} lines`);
  
  if (modifiedCount > 0) {
    console.log(`  ??  ${modifiedCount} lines had dead domains removed from domain lists`);
  }
  
  return outputFile;
}

module.exports = {
  exportCleanedList,
  extractDomainsFromLine
};
