# Minimal Domain Scanner

A Node.js tool that scans adblock filter lists to identify dead domains and redirecting domains, helping maintain clean and efficient filter lists.

## Overview

This tool parses adblock filter lists, checks the status of domains found in various rule types, and categorizes them into:

1. **Dead domains** - Domains that don't resolve or return errors (should be removed)
2. **Redirecting domains** - Domains that redirect to different domains (should be reviewed)

## Features

- **Multiple Rule Format Support**: Handles uBlock Origin, Adguard, and network rules
- **Concurrent Processing**: Checks multiple domains simultaneously for speed
- **Smart Domain Variants**: Optionally checks both `domain.com` and `www.domain.com`
- **Similar Domain Filtering**: Can ignore redirects to subdomains of the same base domain
- **Comprehensive Error Handling**: Detects DNS failures, timeouts, HTTP errors
- **Debug Modes**: Various debug levels for troubleshooting
- **Test Mode**: Quick testing on a subset of domains

## Installation

### Prerequisites

- Node.js (v14 or higher recommended)
- npm (comes with Node.js)

### Setup

```bash
# Clone or download the repository
git clone <your-repo-url>
cd <repo-directory>

# Install dependencies
npm install puppeteer
```

## Usage

### Basic Usage

```bash
node cleaner-adblock.js
```

This will scan the default file (`easylist_specific_hide.txt`) and generate two output files.

### Command-Line Options

```bash
node cleaner-adblock.js [options]
```

#### Input Options

- `--input=<file>` - Specify input file to scan (default: `easylist_specific_hide.txt`)

#### Domain Checking Options

- `--add-www` - Check both `domain.com` and `www.domain.com` for bare domains
- `--ignore-similar` - Ignore redirects to subdomains of same base domain

#### Debug Options

- `--debug` - Enable basic debug output
- `--debug-verbose` - Enable verbose debug output
- `--debug-network` - Log network requests/responses
- `--debug-browser` - Log browser events
- `--debug-all` - Enable all debug options

#### Testing Options

- `--test-mode` - Only test first 5 domains (quick testing)
- `--test-count=N` - Only test first N domains

#### Help

- `--help` or `-h` - Show help message

### Examples

```bash
# Scan custom filter list
node cleaner-adblock.js --input=my_rules.txt

# Check both domain.com and www.domain.com variants
node cleaner-adblock.js --add-www

# Ignore subdomain redirects (reduces noise)
node cleaner-adblock.js --ignore-similar

# Combine options
node cleaner-adblock.js --input=my_rules.txt --add-www --ignore-similar

# Debug mode for troubleshooting
node cleaner-adblock.js --debug --test-mode

# Test first 10 domains with full debugging
node cleaner-adblock.js --debug-all --test-count=10
```

## Supported Rule Types

### uBlock Origin / Cosmetic Rules

```
domain.com##.selector           # Element hiding
domain.com##+js(scriptlet)      # Scriptlet injection
domain.com#@#.selector          # Exception rule
```

### Adguard Rules

```
domain.com##selector            # Element hiding
domain.com#@#selector           # Exception
domain.com#$#selector           # CSS injection
domain.com#%#//scriptlet(...)   # Scriptlet
domain.com#?#selector           # Extended CSS
domain.com#@$?#selector         # Extended CSS exception
domain1.com,domain2.com##selector  # Multiple domains
```

### Network Rules

```
/path$script,domain=example.com
||domain.com^$script,domain=site1.com|site2.com
```

Extracts domains from the `domain=` parameter.

## Output Files

### `dead_domains.txt`

Contains domains that should be **removed** from filter lists:

- HTTP 404, 410, 5xx errors
- DNS resolution failures
- Connection timeouts
- Network errors

Format:
```
# Dead/Non-Existent Domains
# Generated: 2025-11-08T10:30:00.000Z
# Total found: 15

example-dead.com # ERR_NAME_NOT_RESOLVED
old-site.net # 404 Not Found
timeout-site.org # Navigation timeout
```

### `redirect_domains.txt`

Contains domains that **redirect** to different domains (review for potential rule updates):

Format:
```
# Redirecting Domains
# Generated: 2025-11-08T10:30:00.000Z
# Total found: 8

old-domain.com → new-domain.com # https://new-domain.com/
example.org → example.com # https://example.com/
```

## How It Works

1. **Parse Input File**: Extracts unique domains from various filter rule formats
2. **Validate Domains**: Filters out .onion domains, IP addresses, and localhost
3. **Expand Variants**: Optionally creates domain variants with/without www
4. **Browser-Based Checking**: Uses Puppeteer to:
   - Navigate to each domain
   - Follow redirects
   - Detect DNS failures
   - Handle HTTP errors
   - Capture timeouts
5. **Categorize Results**: Separates dead domains from redirecting domains
6. **Generate Reports**: Creates organized output files with explanations

## Configuration

Default settings (can be modified in the code):

```javascript
const TIMEOUT = 25000;              // Page load timeout (25 seconds)
const FORCE_CLOSE_TIMEOUT = 60000;  // Force-close timeout (60 seconds)
const CONCURRENCY = 12;              // Concurrent domain checks
```

## Special Features

### `--add-www` Behavior

- `domain.com` → checks both `domain.com` AND `www.domain.com`
- If **either** works, domain is marked as active
- `sub.domain.com` → only checks `sub.domain.com` (no www added)
- `www.domain.com` → only checks `www.domain.com` (already has www)

### `--ignore-similar` Behavior

Reduces noise from internal subdomain redirects:

- `example.com` → `sub.example.com` (ignored - same base domain)
- `example.com` → `different.com` (flagged - different domain)

Useful for sites that redirect to CDN or regional subdomains.

## Error Handling

The tool handles various error scenarios:

- DNS failures (ERR_NAME_NOT_RESOLVED)
- Connection errors (ERR_CONNECTION_REFUSED, ERR_CONNECTION_TIMED_OUT)
- HTTP status codes (404, 410, 5xx)
- SSL/Certificate errors (automatically ignored)
- Page load timeouts
- Navigation errors

## Troubleshooting

### Issue: "Cannot find module 'puppeteer'"

```bash
npm install puppeteer
```

### Issue: Browser fails to launch

Try adding more Puppeteer args in the code:
```javascript
args: [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage'
]
```

### Issue: Too many timeouts

Increase the timeout value:
```javascript
const TIMEOUT = 35000; // 35 seconds
```

### Issue: Running out of memory

Reduce concurrency:
```javascript
const CONCURRENCY = 6; // Lower concurrency
```

## Performance Tips

- Use `--test-mode` first to verify everything works
- Adjust `CONCURRENCY` based on your system resources
- Use `--ignore-similar` to reduce false positives
- Monitor system resources during large scans
- Consider splitting very large filter lists

## Use Cases

- **Filter List Maintenance**: Identify outdated domains in adblock lists
- **List Optimization**: Remove dead domains to reduce list size
- **Rule Updates**: Find domains that need rule updates due to redirects
- **Quality Assurance**: Validate filter lists before distribution
- **Domain Research**: Analyze domain status across multiple filter lists

## License

[Specify your license here]

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Acknowledgments

Built with [Puppeteer](https://pptr.dev/) for reliable browser automation and domain checking.

## Support

For issues, questions, or suggestions, please [open an issue](your-issue-tracker-url) on GitHub.
