// === Export Module for Adblock Filter Lists ===
// Removes dead and redirected domains from filter lists

const fs = require('fs');
const path = require('path');

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
function cleanDomainParameter(line, domainsToRemove) {
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
    return !domainsToRemove.has(cleanDomain);
  });
  
  // If all domains removed, return null (remove entire line)
  if (cleanedDomains.length === 0) {
    return null;
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
function exportCleanedList(inputFile, deadDomains, redirectDomains, timestamp) {
  console.log(`\n=== Exporting Cleaned Filter List ===`);
  
  // Create set of domains to remove (only dead domains, not redirects)
  const domainsToRemove = new Set(deadDomains.map(d => d.domain.toLowerCase()));
  console.log(`Domains to remove: ${domainsToRemove.size}`);
  
  // Read input file
  const inputContent = fs.readFileSync(inputFile, 'utf8');
  const inputLines = inputContent.split('\n');
  
  // Process lines
  const outputLines = [];
  const modifiedLines = [];
  let removedCount = 0;
  let modifiedCount = 0;
  
  for (const line of inputLines) {
    // Skip comments and empty lines - keep as-is
    if (!line.trim() || line.trim().startsWith('!') || line.trim().startsWith('[')) {
      outputLines.push(line);
      continue;
    }
    
    let processedLine = line;
    
    // Try to clean domain= parameters first
    if (line.includes('domain=')) {
      processedLine = cleanDomainParameter(processedLine, domainsToRemove);
      if (processedLine === null) {
        removedCount++;
        continue;
      }
      if (processedLine !== line) {
        modifiedCount++;
        modifiedLines.push({ original: line, modified: processedLine });
      }
    }
    
    // Try to clean cosmetic domain lists
    if (processedLine.match(/^([^#$]+)(?:#[@$%?]*#|\$\$)/)) {
      processedLine = cleanCosmeticDomains(processedLine, domainsToRemove);
      if (processedLine === null) {
        removedCount++;
        continue;
      }
      if (processedLine !== line) {
        modifiedCount++;
        modifiedLines.push({ original: line, modified: processedLine });
      }
    }
    
    // Check if line still contains dead domains in || rules
    const lineDomains = extractDomainsFromLine(processedLine);
    let hasDeadDomain = false;
    for (const domain of lineDomains) {
      if (domainsToRemove.has(domain)) {
        hasDeadDomain = true;
        break;
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
  
  fs.writeFileSync(outputFile, finalOutput, 'utf8');
  console.log(`? Cleaned filter list: ${outputFile}`);
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
