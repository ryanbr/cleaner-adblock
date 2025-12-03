# Minimal Domain Scanner

A Node.js tool that scans adblock filter lists to identify dead domains and redirecting domains, helping maintain clean and efficient filter lists.

<img width="1129" height="476" alt="clean33" src="https://github.com/user-attachments/assets/d1daa62a-af1b-489b-b89f-d3b2d76c5e21" />

## Overview

This tool parses adblock filter lists, checks the status of domains found in various rule types, and categorizes them into:

1. **Dead domains** - Domains that don't resolve or return errors (should be removed)
2. **Redirecting domains** - Domains that redirect to different domains (should be reviewed)

## Features

- **Multiple Rule Format Support**: Handles uBlock Origin, Adguard, and network rules
- **Simple Domain Lists**: Can also parse plain domain lists (one per line)
- **Concurrent Processing**: Checks multiple domains simultaneously for speed
- **Smart Domain Variants**: Optionally checks both `domain.com` and `www.domain.com`
- **Similar Domain Filtering**: Can ignore redirects to subdomains of the same base domain
- **DNS Verification**: Optionally verify dead domains with DNS lookups
- **Export Cleaned Lists**: Generate filter lists with dead domains removed
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
git clone git@github.com:ryanbr/cleaner-adblock.git
cd cleaner-adblock

# Install dependencies
npm install puppeteer
```

## Usage

### Basic Usage

```bash
node cleaner-adblock.js <file>
```

This will scan the specified file and generate two timestamped output files.

### Command-Line Options

```bash
node cleaner-adblock.js <file> [options]
```

#### Input Options

- `--input=<file>` - Specify input file to scan (alternative to positional arg)
- `--simple-domains` - Parse input as plain domain list (one per line) instead of filter rules

#### Domain Checking Options

- `--add-www` - Check both `domain.com` and `www.domain.com` for bare domains
- `--ignore-similar` - Ignore redirects to subdomains of same base domain
- `--check-dig` - Verify dead domains with DNS lookup
- `--check-dig-always` - Only report domains with no DNS A records

#### Output Options

- `--export-list` - Export cleaned filter list (removes dead domains)

#### Performance Options

- `--concurrency=N` - Number of concurrent checks (1-50, default: 12)
- `--disable-block-resources` - Allow images/CSS/fonts to load (slower scans)

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
# Scan a filter list
node cleaner-adblock.js my_rules.txt

# Scan with input flag
node cleaner-adblock.js --input=my_rules.txt

# Scan a simple list of domains (one per line)
node cleaner-adblock.js domains.txt --simple-domains

# Check both domain.com and www.domain.com variants
node cleaner-adblock.js my_rules.txt --add-www

# Ignore subdomain redirects (reduces noise)
node cleaner-adblock.js my_rules.txt --ignore-similar

# Combine options
node cleaner-adblock.js my_rules.txt --add-www --ignore-similar

# Only report domains with no DNS records
node cleaner-adblock.js my_rules.txt --check-dig-always

# Export a cleaned filter list
node cleaner-adblock.js my_rules.txt --export-list

# Increase concurrency for faster scans
node cleaner-adblock.js my_rules.txt --concurrency=20

# Debug mode for troubleshooting
node cleaner-adblock.js my_rules.txt --debug --test-mode

# Test first 10 domains with full debugging
node cleaner-adblock.js my_rules.txt --debug-all --test-count=10
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

### Simple Domain Lists

When using `--simple-domains`:

```
example.com
another-domain.org
# Comments are ignored
domain1.com, domain2.com, domain3.net
```

## Output Files

Output files are timestamped to avoid overwriting previous scans.

### `dead_domains_TIMESTAMP.txt`

Contains domains that should be **removed** from filter lists:

- HTTP 404, 410, 5xx errors
- DNS resolution failures
- Connection timeouts
- Network errors

Format:
```
# Dead/Non-Existent Domains
# Scanned file: my_rules.txt
# Generated: 2025-11-08T10:30:00.000Z
# Total found: 15

example-dead.com # ERR_NAME_NOT_RESOLVED
old-site.net # HTTP 404
timeout-site.org # Navigation timeout of 25000ms exceeded
```

### `redirect_domains_TIMESTAMP.txt`

Contains domains that **redirect** to different domains (review for potential rule updates):

Format:
```
# Redirecting Domains
# Scanned file: my_rules.txt
# Generated: 2025-11-08T10:30:00.000Z
# Total found: 8

old-domain.com ? new-domain.com # https://new-domain.com/
example.org ? example.com # https://example.com/
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
5. **DNS Verification**: Optionally verifies dead domains with dig
6. **Categorize Results**: Separates dead domains from redirecting domains
7. **Generate Reports**: Creates organized output files with explanations

## Configuration

Default settings (can be modified via command line or in the code):

```javascript
const TIMEOUT = 25000;              // Page load timeout (25 seconds)
const FORCE_CLOSE_TIMEOUT = 60000;  // Force-close timeout (60 seconds)
const CONCURRENCY = 12;             // Concurrent domain checks (use --concurrency=N)
```

You can also edit the `IGNORED_DOMAINS` array in the script to skip specific domains that are incorrectly flagged.

## Special Features

### `--simple-domains` Behavior

Parses input as a plain domain list instead of filter rules:
- One domain per line
- Supports comma-separated domains
- Ignores lines starting with `#`, `!`, or `//`
- Automatically strips protocols and paths

### `--check-dig` and `--check-dig-always` Behavior

- `--check-dig` - Adds DNS A record info to dead domain output
- `--check-dig-always` - Filters dead domains to only include those with no DNS A records. Useful for confirming domains are truly dead vs temporarily unavailable.

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

### `--export-list` Behavior

Generates a cleaned version of the original filter list with dead domains removed. The cleaned list is saved with a `_cleaned_TIMESTAMP` suffix.

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

Increase the timeout value in the code:
```javascript
const TIMEOUT = 35000; // 35 seconds
```

### Issue: Running out of memory

Reduce concurrency:
```bash
node cleaner-adblock.js my_rules.txt --concurrency=6
```

## Performance Tips

- Use `--test-mode` first to verify everything works
- Adjust concurrency with `--concurrency=N` based on your system resources
- Use `--ignore-similar` to reduce false positives
- Use default resource blocking (don't use `--disable-block-resources`) for faster scans
- Monitor system resources during large scans
- Consider splitting very large filter lists

## Use Cases

- **Filter List Maintenance**: Identify outdated domains in adblock lists
- **List Optimization**: Remove dead domains to reduce list size
- **Rule Updates**: Find domains that need rule updates due to redirects
- **Quality Assurance**: Validate filter lists before distribution
- **Domain Research**: Analyze domain status across multiple filter lists

## License

[GPL](https://github.com/ryanbr/cleaner-adblock/blob/main/LICENSE)

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Acknowledgments

Built with [Puppeteer](https://pptr.dev/) for reliable browser automation and domain checking.

## Support

For issues, questions, or suggestions, please [open an issue](https://github.com/ryanbr/cleaner-adblock/issues) on GitHub.
