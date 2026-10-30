#!/usr/bin/env bash
# Set up Google Search Console for a site with the gcloud CLI, no clicking in the Search Console UI.
#
#   1. bash scripts/gsc-setup.sh login            # once: sign in with the Search Console scopes
#   2. bash scripts/gsc-setup.sh token  <site>    # prints the meta-tag value Google wants on the home page
#      -> put it in Vercel as GOOGLE_SITE_VERIFICATION (Production) and redeploy (Claude can do this step)
#   3. bash scripts/gsc-setup.sh finish <site>    # verifies ownership, adds the property, submits the sitemap
#   4. bash scripts/gsc-setup.sh status <site>    # sitemap status and how Google sees the key pages
#
# <site> is the URL-prefix property, e.g. https://promogranade.com/ (keep the trailing slash).
# Needs: gcloud signed in to the Google account that should own the property, and a Google Cloud project
# set as quota project (step 1 enables the two APIs in it). Requesting indexing is not available in any
# Google API; use the "Request indexing" button in Search Console for the few pages that matter.
set -euo pipefail

cmd=${1:-}
site=${2:-https://promogranade.com/}
enc=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$site")
api() { curl -sS -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" -H "x-goog-user-project: $(gcloud config get-value project 2>/dev/null)" -H "Content-Type: application/json" "$@"; }

case "$cmd" in
  login)
    gcloud auth application-default login \
      --scopes=https://www.googleapis.com/auth/webmasters,https://www.googleapis.com/auth/siteverification,https://www.googleapis.com/auth/cloud-platform
    project=$(gcloud config get-value project 2>/dev/null)
    [ -z "$project" ] && { echo "Set a project first: gcloud config set project <id>"; exit 1; }
    gcloud auth application-default set-quota-project "$project"
    gcloud services enable siteverification.googleapis.com searchconsole.googleapis.com
    ;;
  token)
    api -X POST https://www.googleapis.com/siteVerification/v1/token \
      -d "{\"site\":{\"type\":\"SITE\",\"identifier\":\"$site\"},\"verificationMethod\":\"META\"}" |
      python3 -c 'import sys,json,re;t=json.load(sys.stdin);print(re.search(r"content=\"([^\"]+)\"",t["token"]).group(1))'
    ;;
  finish)
    echo "Verifying ownership..."
    api -X POST "https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=META" \
      -d "{\"site\":{\"type\":\"SITE\",\"identifier\":\"$site\"}}"
    echo; echo "Adding the Search Console property..."
    api -X PUT "https://www.googleapis.com/webmasters/v3/sites/$enc" -o /dev/null -w "%{http_code}\n"
    echo "Submitting the sitemap..."
    sm=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]+"sitemap.xml",safe=""))' "$site")
    api -X PUT "https://www.googleapis.com/webmasters/v3/sites/$enc/sitemaps/$sm" -o /dev/null -w "%{http_code}\n"
    echo "Done. Run: bash scripts/gsc-setup.sh status $site"
    ;;
  status)
    api "https://www.googleapis.com/webmasters/v3/sites/$enc/sitemaps"; echo
    for path in "" about services blog; do
      echo "== ${site}${path}"
      api -X POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect \
        -d "{\"inspectionUrl\":\"${site}${path}\",\"siteUrl\":\"$site\"}" |
        python3 -c 'import sys,json;r=json.load(sys.stdin).get("inspectionResult",{}).get("indexStatusResult",{});print(" ",r.get("verdict"),"|",r.get("coverageState"),"| last crawl:",r.get("lastCrawlTime"))'
    done
    ;;
  *)
    sed -n '2,15p' "$0"; exit 1 ;;
esac
