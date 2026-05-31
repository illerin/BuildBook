# Security

BuildBook is a local-first desktop app with an optional LAN web server. Leave local network access off unless you are actively using it.

## Recommended Setup

- Use the desktop app directly for normal local use.
- If exposing BuildBook through a reverse proxy, use HTTPS at the proxy.
- Enable `Settings > Web Login Security`.
- Set an admin password before enabling web login.
- Keep the LAN access token enabled unless you have a specific reason to disable it.
- Set `Allowed domains` to the exact reverse-proxy host names you expect, such as `buildbook.example.com`.
- Do not expose the BuildBook LAN port directly to the public internet.

## What Web Login Protects

Web login protects browser/API access to the BuildBook LAN server. It does not add multi-user permissions. Anyone with the admin password can access the full app and all stored project data.

Sessions use an HttpOnly cookie. When BuildBook detects an HTTPS reverse proxy using `X-Forwarded-Proto: https`, it also marks the session cookie as Secure.

## Reverse Proxy Notes

For Nginx Proxy Manager or a similar proxy:

- Forward to the BuildBook LAN address using HTTP.
- Serve the public side with HTTPS.
- Preserve the original Host header.
- Send `X-Forwarded-Proto: https`.

The optional allowed-domain list rejects unexpected Host headers while still allowing localhost and private LAN addresses.

## Reporting Security Issues

If this repository has GitHub Security Advisories enabled, report private vulnerabilities there. Otherwise, open a GitHub issue with minimal reproduction details and avoid posting private project data, passwords, tokens, or exported backups.
