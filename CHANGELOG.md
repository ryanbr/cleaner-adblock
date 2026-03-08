# Changelog

## Unreleased

- Add `.cleanerconfig` support for per-project and per-file settings
- Add `--use-config=<file>` flag to specify a custom config file
- Support color flag from `.cleanerconfig`
- Include input filename in output file names
- Add `--check-ping` to startup summary output
- Move hardcoded ignored domains to `.cleanerconfig`
- Remove unused `IGNORE_NAV_TIMEOUT` flag and `--ignore-nav-timeout` parsing
- Standardize error output to use `tags.error` from colorize module
- Pre-compute ignored domain suffixes for faster lookups
- Add 5s timeout to `page.close()` to prevent worker hangs
- Single-pass result separation instead of double filter+map
- Add browser launch flags to reduce Chromium resource usage
- Set user agent at browser level instead of per-page
- Replace `new URL()` with string ops in response listener hot path
- Update README with new features and `.cleanerconfig` docs

## 2.0.10

- Fix crash from ProtocolError when browser is overloaded
- Hoist regex literals to module level to avoid recompilation per line
- V8 optimizations: shared empty array and single regex for error matching
- Write redirect domains file before moving them to dead list
- Fix summary showing 0 redirects when using `--check-ping`

## 2.0.9

- Ensure NXDOMAIN match all DNS servers
- Batch DNS checks to prevent spawning unbounded dig processes
- Add graceful shutdown handling for SIGINT/SIGTERM
- Add `--check-ping` flag to verify dead domains with ping before confirming
- Use Set for O(1) exact match in `shouldIgnoreDomain`
- Hoist blocked resource types Set to module level
- Remove duplicate 'Checking domain' log line
- Remove dead commented-out code
- Move lingering page cleanup log to debug-only output
- Hoist `extractDomain` helper to module level
- Move redirecting domains to dead list when using `--check-ping`
- Skip pinging redirected domains, add to dead list after ping checks
- Add lib/ files to `package.json` files array for npm publish
- Update deprecated `headless: 'new'` to `headless: true` for Puppeteer 24+
- Fix `--export-list` to also trigger when only redirect domains exist
- Fix debug logging to show actually ignored input domains
- Replace fixed-batch processing with rolling worker pool
- Skip pinging dead domains with HTTP errors (404/5xx have a running server)
- Update `package-lock.json` to match `package.json` dependencies

## 2.0.8

- Fix bin path per npm pkg fix
- Support `--remove-redirects`
- Improve DNS checks
- Expand to `ERR_BLOCKED_BY_CLIENT` errors
- Support `$domain=dead.com` network rules
- Ignore `.*` wildcard domains and ensure all domains matched before removing
- Fix intermittent lines being removed
- Add more checks for `sub.domain.com`, `www.domain.com` and domain when used with `--add-www`

## 2.0.7

- Fix double-counting bug
- Improve error handling
- Remove unused functions
- Fix similar domains detection
- Update ignored domains

## 2.0.6

- Support `--localhost` for hosts file format parsing
- Support `--quick-disconnect` for faster scans
- Support `--color`/`--colour` for colored output
- Improve debug console output
- Support href cosmetic domain checks
- Fix race conditions and performance improvements
- Attribute URL extraction support
- Fix `request.abort()` and `request.continue()` throwing on closed pages
- Move `resourceType` check to Set lookup

## 2.0.5

- Add `--concurrency` for configurable concurrent checks
- Eliminate page close race condition with unified `safeClosePage` helper
- Allow file input without `--input` flag
- Fix dead domain detection for connection errors
- Enable block-resources as default
- Skip any domains with wildcards
- Support removing redirected domains in `--export-list`
- Fix TypeError on undefined `hasRecord`

## 2.0.4

- Support HTML filtering rules (`$$`)
- Allow DNS checks on dead domains with `--check-dig` and `--check-dig-always`
- Make DNS checks async with improved performance
- Allow exporting changes to adblock compatible list with `--export-list`
- Match subdomains in `IGNORED_DOMAINS`

## 2.0.3

- Add timestamp to output filenames
- Show input filename in output files
- Fix Puppeteer old Headless deprecation warning
- Support `||domain.com` rules and `$domain=site|site2`
- Allow importing plain domain lists with `--simple-domains`
- Don't flag anti-bot messages as 403s

## 2.0.2

- Add npm publish workflow
- Remove default list requirement, requires `--input=file`
- Add support for `--block-resources` when scanning

## 2.0.1

- Initial release with domain scanning via Puppeteer
- Support for uBlock Origin and Adguard rule formats
- Dead domain and redirect domain detection
- DNS verification with `dig`
- Debug modes for troubleshooting
- Ignored domains list
- Improve 403 domain detection
- Multi-label TLD support in `getBaseDomain()`
