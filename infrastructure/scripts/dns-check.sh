#!/usr/bin/env bash
#
# dns-check.sh — luxiga.co DNS health check
#
# Queries multiple public resolvers and reports any disagreement, SERVFAIL,
# empty response, or the DNSSEC-misconfig failure mode from 2026-04-10.
#
# Usage:
#   ./dns-check.sh           # quick check (A records + DS + NS)
#   ./dns-check.sh --full    # full check (all record types from zone-luxiga-co.md)
#
# Exit codes:
#   0 = healthy
#   1 = degraded (warnings present)
#   2 = outage (resolvers failing or split-brain)
#   3 = DNSSEC misconfiguration detected
#
# Requires: dig. Portable to macOS default Bash 3.2 (no associative arrays).

set -u

DOMAIN="luxiga.co"
RESOLVERS="1.1.1.1 8.8.8.8 9.9.9.9"
EXPECTED_IPS_SORTED="185.199.108.153,185.199.109.153,185.199.110.153,185.199.111.153"

if [ -t 1 ]; then
    RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
    BLUE=$'\033[0;34m'; RESET=$'\033[0m'
else
    RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

EXIT_CODE=0
FULL=0
if [ "${1:-}" = "--full" ]; then
    FULL=1
fi

pass() { echo "${GREEN}[PASS]${RESET} $1"; }
warn() { echo "${YELLOW}[WARN]${RESET} $1"; [ $EXIT_CODE -lt 1 ] && EXIT_CODE=1; }
fail() { echo "${RED}[FAIL]${RESET} $1"; [ $EXIT_CODE -lt 2 ] && EXIT_CODE=2; }
info() { echo "${BLUE}[INFO]${RESET} $1"; }

if ! command -v dig >/dev/null 2>&1; then
    echo "${RED}error:${RESET} dig is not installed (install bind-tools / bind-utils)" >&2
    exit 2
fi

echo "Checking DNS health for ${DOMAIN}"
echo "Resolvers: ${RESOLVERS}"
echo

#
# Check 1: A records at each resolver
#
echo "--- A records ---"
all_results=""
for r in $RESOLVERS; do
    raw=$(dig A "${DOMAIN}" "@${r}" +short +time=3 +tries=1 2>&1)
    rc=$?
    sorted=$(echo "$raw" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | sort | tr '\n' ',' | sed 's/,$//')

    if echo "$raw" | grep -qi "SERVFAIL"; then
        fail "${r}: SERVFAIL"
        all_results="${all_results}SERVFAIL|"
    elif [ $rc -ne 0 ] || [ -z "$sorted" ]; then
        fail "${r}: no answer (rc=${rc})"
        all_results="${all_results}EMPTY|"
    else
        pass "${r}: ${sorted}"
        all_results="${all_results}${sorted}|"
        if [ "$sorted" != "$EXPECTED_IPS_SORTED" ]; then
            warn "${r} returned unexpected IPs — expected ${EXPECTED_IPS_SORTED}"
        fi
    fi
done

# Split-brain detection
unique=$(echo "$all_results" | tr '|' '\n' | grep -v '^$' | sort -u | wc -l | tr -d ' ')
if [ "$unique" -gt 1 ]; then
    warn "Resolvers disagree — split-brain detected"
fi

echo

#
# Check 2: DS record at .co parent (DNSSEC sanity)
#
echo "--- DNSSEC ---"
ds=$(dig DS "${DOMAIN}" @1.1.1.1 +short +time=3 +tries=1 2>/dev/null)
if [ -z "$ds" ]; then
    pass "No DS record at .co (zone is unsigned — expected for Namecheap BasicDNS)"
else
    info "DS record present: ${ds}"
    raw_full=$(dig A "${DOMAIN}" @1.1.1.1 +time=3 +tries=1 2>&1)
    if echo "$raw_full" | grep -q "SERVFAIL"; then
        fail "DS record published but zone returns SERVFAIL — DNSSEC misconfigured"
        fail "See dns/dnssec-incident-2026-04-10.md for fix"
        EXIT_CODE=3
    else
        pass "DS record present and zone resolves — DNSSEC appears valid"
    fi
fi

echo

#
# Check 3: Authoritative nameservers
#
echo "--- Nameservers ---"
ns=$(dig NS "${DOMAIN}" @1.1.1.1 +short +time=3 +tries=1 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')
if [ -z "$ns" ]; then
    # Try without validation (may be SERVFAIL due to DNSSEC)
    ns=$(dig NS "${DOMAIN}" @1.1.1.1 +short +cd +time=3 +tries=1 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')
    if [ -n "$ns" ]; then
        warn "NS only returned with validation disabled (+cd) — confirms DNSSEC failure"
    fi
fi

if [ -z "$ns" ]; then
    fail "No NS records returned from any query"
else
    info "NS: ${ns}"
    case "$ns" in
        *registrar-servers.com*) info "Provider: Namecheap BasicDNS" ;;
        *cloudflare.com*)        info "Provider: Cloudflare" ;;
        *)                       warn "Unrecognized NS provider — verify intentional" ;;
    esac
fi

echo

#
# Full mode: additional record types
#
if [ $FULL -eq 1 ]; then
    echo "--- Full check ---"

    www=$(dig CNAME "www.${DOMAIN}" @1.1.1.1 +short +cd 2>/dev/null)
    if [ -z "$www" ]; then
        warn "No CNAME for www.${DOMAIN}"
    else
        pass "www → ${www}"
    fi

    mx=$(dig MX "${DOMAIN}" @1.1.1.1 +short +cd 2>/dev/null)
    if [ -z "$mx" ]; then
        fail "No MX records — mail broken"
    else
        echo "$mx" | while read -r line; do
            [ -n "$line" ] && pass "MX: ${line}"
        done
    fi

    spf=$(dig TXT "${DOMAIN}" @1.1.1.1 +short +cd 2>/dev/null | grep "v=spf1" || true)
    if [ -z "$spf" ]; then
        warn "No SPF record found"
    else
        pass "SPF: ${spf}"
    fi

    pulse=$(dig CNAME "pulse.${DOMAIN}" @1.1.1.1 +short +cd 2>/dev/null)
    if [ -z "$pulse" ]; then
        info "pulse.${DOMAIN} not configured (skip if Pulse not yet deployed)"
    else
        pass "pulse → ${pulse}"
    fi

    echo
fi

#
# Summary
#
echo "--- Summary ---"
case $EXIT_CODE in
    0) echo "${GREEN}HEALTHY${RESET} — all checks passed" ;;
    1) echo "${YELLOW}DEGRADED${RESET} — warnings present, investigate" ;;
    2) echo "${RED}OUTAGE${RESET} — resolvers failing or split-brain" ;;
    3) echo "${RED}DNSSEC MISCONFIG${RESET} — see dns/dnssec-incident-2026-04-10.md" ;;
esac

exit $EXIT_CODE
