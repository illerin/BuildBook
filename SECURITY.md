# BuildBook Security Notes

BuildBook is intended for trusted personal or workshop networks. Do not expose the direct LAN server port to the public internet.

Recommended setup:
- Use Tailscale, a VPN, or a reverse proxy with HTTPS for remote access.
- Keep the LAN access token enabled unless all access is already protected by another trusted layer.
- Enable web login when using a domain or reverse proxy.
- Use pairing codes for multi-computer sync, then revoke devices that should no longer connect.
- Keep Windows and BuildBook updated.

Host sync model:
- One computer acts as the authoritative host.
- Paired client computers receive per-device credentials.
- Pairing codes expire and are rate-limited after repeated bad attempts.
- Linked file paths belong to the host computer; project exports pack those files as portable local copies.

Known limits:
- BuildBook is not a multi-user internet service.
- Reverse proxy authentication or VPN access is still recommended for any access outside the LAN.
- If you suspect a security issue, report it through the GitHub repository issue tracker or security advisory feature if enabled.
