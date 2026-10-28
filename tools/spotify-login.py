#!/usr/bin/env python3
"""One-time Spotify sign-in for the Soundtrack mod (Authorization Code with PKCE).

Usage:  python3 spotify-login.py <client id>

Registers nothing and needs no client secret. It opens Spotify's consent page,
catches the redirect on http://127.0.0.1:8765/callback, trades the code for
tokens and writes them to ~/.config/soundtrack/spotify-auth.json (mode 600).
The mod reads that file and refreshes the token itself from then on.
"""
import base64
import hashlib
import http.server
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import webbrowser

REDIRECT = "http://127.0.0.1:8765/callback"
SCOPES = " ".join([
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
])
AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
OUT = os.path.expanduser("~/.config/soundtrack/spotify-auth.json")


def open_browser(url: str) -> None:
    # WSL: hand the URL to Windows. Elsewhere: the default browser.
    if shutil.which("powershell.exe"):
        try:
            subprocess.run(["powershell.exe", "-NoProfile", "-Command", f"Start-Process '{url}'"], check=True, timeout=20)
            return
        except Exception:
            pass
    if not webbrowser.open(url):
        print("Open this URL in your browser:\n" + url)


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        print(__doc__)
        return 2
    client_id = sys.argv[1].strip()
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT,
        "scope": SCOPES,
        "state": state,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
    }
    url = AUTH_URL + "?" + urllib.parse.urlencode(params)

    got: dict = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if urllib.parse.urlparse(self.path).path != "/callback":
                self.send_response(404)
                self.end_headers()
                return
            got.update({k: v[0] for k, v in query.items()})
            ok = "code" in got and got.get("state") == state
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            msg = "Soundtrack is signed in to Spotify. You can close this tab." if ok else "Sign-in failed: " + got.get("error", "state mismatch")
            self.wfile.write(f"<html><body style='font-family:sans-serif;padding:2em'>{msg}</body></html>".encode())

        def log_message(self, *_):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 8765), Handler)
    print("Waiting for Spotify to redirect back on " + REDIRECT + " ...")
    open_browser(url)
    while "code" not in got and "error" not in got:
        server.handle_request()
    server.server_close()

    if "error" in got:
        print("Spotify refused: " + got["error"])
        return 1
    if got.get("state") != state:
        print("State mismatch: the redirect did not come from this sign-in. Try again.")
        return 1

    body = urllib.parse.urlencode({
        "client_id": client_id,
        "grant_type": "authorization_code",
        "code": got["code"],
        "redirect_uri": REDIRECT,
        "code_verifier": verifier,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            tokens = json.load(res)
    except urllib.error.HTTPError as err:
        print("Token exchange failed: HTTP " + str(err.code) + " " + err.read().decode(errors="replace"))
        return 1

    record = {
        "client_id": client_id,
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "expires_at": int(time.time() * 1000) + int(tokens.get("expires_in", 3600)) * 1000,
        "scope": tokens.get("scope", SCOPES),
    }
    os.makedirs(os.path.dirname(OUT), mode=0o700, exist_ok=True)
    fd = os.open(OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(record, fh, indent=2)
    print("Signed in. Tokens saved to " + OUT)
    print("Scopes granted: " + record["scope"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
