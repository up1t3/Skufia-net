
import http.server
import http.client
import socketserver
import urllib.parse
import os

PORT = 5551
BACKEND_HOST = "localhost"
BACKEND_PORT = 8007

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/"):
            self.proxy_request("GET")
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self.proxy_request("POST")
        else:
            self.send_error(404)

    def proxy_request(self, method):
        # Strip the /api prefix before forwarding to the backend
        remote_path = self.path[4:] if self.path.startswith("/api") else self.path
        if not remote_path: remote_path = "/"

        # Read the request body for POST
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        # Build the proxy request
        conn = http.client.HTTPConnection(BACKEND_HOST, BACKEND_PORT)
        
        # Headers transformation
        headers = {key: value for key, value in self.headers.items() if key.lower() not in ('host', 'content-length')}
        
        try:
            conn.request(method, remote_path, body, headers)
            res = conn.getresponse()
            
            # Send response back to client
            self.send_response(res.status)
            for key, value in res.getheaders():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(res.read())
        except Exception as e:
            self.send_error(502, f"Proxy Error: {str(e)}")
        finally:
            conn.close()

os.chdir(os.path.dirname(__file__))
with socketserver.ThreadingTCPServer(("", PORT), ProxyHandler) as httpd:
    print(f"Skufia-Net Frontend Proxy running at http://localhost:{PORT}")
    print(f"Proxying /api to http://{BACKEND_HOST}:{BACKEND_PORT}")
    httpd.serve_forever()
