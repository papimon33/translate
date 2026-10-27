import http.server, socketserver, functools

DIRECTORY = "/Users/jake/Documents/claude/translate/map"
PORT = 8765

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIRECTORY)

class Server(socketserver.TCPServer):
    allow_reuse_address = True

with Server(("127.0.0.1", PORT), Handler) as httpd:
    print(f"serving {DIRECTORY} at http://127.0.0.1:{PORT}")
    httpd.serve_forever()
