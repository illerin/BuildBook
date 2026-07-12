use std::io::{Read, Write};
use std::net::TcpStream;

const LAN_REQUEST_BODY_LIMIT_BYTES: usize = 64 * 1024 * 1024;

fn decode_url_value(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex);
                index += 3;
                continue;
            }
        }
        output.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

pub(crate) fn query_value(path: &str, key: &str) -> String {
    path.split_once('?')
        .map(|(_, query)| query)
        .unwrap_or("")
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(name, _)| *name == key)
        .map(|(_, value)| decode_url_value(value))
        .unwrap_or_default()
}

pub(crate) fn header_value(headers: &str, key: &str) -> String {
    let prefix = format!("{}:", key.to_lowercase());
    headers
        .lines()
        .find_map(|line| {
            let lower = line.to_lowercase();
            if lower.starts_with(&prefix) {
                line.split_once(':')
                    .map(|(_, value)| value.trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_default()
}

pub(crate) fn cookie_value(headers: &str, key: &str) -> String {
    header_value(headers, "cookie")
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find(|(name, _)| *name == key)
        .map(|(_, value)| value.trim().to_string())
        .unwrap_or_default()
}

pub(crate) fn content_type(path: &str) -> &'static str {
    if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else if path.ends_with(".pdf") {
        "application/pdf"
    } else {
        "application/octet-stream"
    }
}

pub(crate) fn send_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    send_response_with_headers(stream, status, content_type, body, &[]);
}

pub(crate) fn send_response_with_headers(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    headers: &[String],
) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    let _ = write!(stream, "X-Content-Type-Options: nosniff\r\n");
    let _ = write!(stream, "X-Frame-Options: DENY\r\n");
    let _ = write!(stream, "Referrer-Policy: no-referrer\r\n");
    let _ = write!(stream, "Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; media-src 'self' data: blob:; frame-src 'self' blob: data:; connect-src 'self' http: https:\r\n");
    let _ = write!(
        stream,
        "Permissions-Policy: camera=(), microphone=(), geolocation=()\r\n"
    );
    for header in headers {
        let _ = write!(stream, "{header}\r\n");
    }
    let _ = write!(stream, "\r\n");
    let _ = stream.write_all(body);
}

fn body_from_request(
    stream: &mut TcpStream,
    initial: &[u8],
    headers: &str,
) -> Result<Vec<u8>, String> {
    let length_header = header_value(headers, "content-length");
    let length = length_header
        .is_empty()
        .then(|| Err("Request is missing Content-Length.".to_string()))
        .unwrap_or_else(|| Ok(length_header))?
        .parse::<usize>()
        .map_err(|_| "Request has an invalid Content-Length.".to_string())?;
    if length > LAN_REQUEST_BODY_LIMIT_BYTES {
        return Err("Request body is too large.".to_string());
    }
    let header_end = initial
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
        .unwrap_or(initial.len());
    let mut body = initial.get(header_end..).unwrap_or(&[]).to_vec();
    while body.len() < length {
        let mut buffer = vec![0; (length - body.len()).min(64 * 1024)];
        match stream.read(&mut buffer) {
            Ok(0) => {
                return Err(format!(
                    "Request body ended early: received {} of {length} bytes.",
                    body.len()
                ))
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock
                ) =>
            {
                std::thread::sleep(std::time::Duration::from_millis(20));
                continue;
            }
            Err(error) => return Err(format!("Could not read request body: {error}")),
            Ok(count) => body.extend_from_slice(&buffer[..count]),
        }
    }
    body.truncate(length);
    Ok(body)
}

fn parse_chunked_body(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    let mut index = 0;
    loop {
        let Some(line_end) = bytes[index..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .map(|offset| index + offset)
        else {
            return Err("Chunked request body is incomplete.".to_string());
        };
        let size_text = String::from_utf8_lossy(&bytes[index..line_end]);
        let size_hex = size_text.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|_| "Chunked request body has an invalid chunk size.".to_string())?;
        index = line_end + 2;
        if size == 0 {
            return Ok(body);
        }
        if index + size + 2 > bytes.len() {
            return Err("Chunked request body is truncated.".to_string());
        }
        body.extend_from_slice(&bytes[index..index + size]);
        index += size;
        if bytes.get(index..index + 2) != Some(b"\r\n") {
            return Err("Chunked request body has an invalid separator.".to_string());
        }
        index += 2;
    }
}

pub(crate) fn request_body(
    stream: &mut TcpStream,
    initial: &[u8],
    headers: &str,
) -> Result<Vec<u8>, String> {
    if header_value(headers, "transfer-encoding")
        .to_ascii_lowercase()
        .contains("chunked")
    {
        let header_end = initial
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|index| index + 4)
            .unwrap_or(initial.len());
        let mut bytes = initial.get(header_end..).unwrap_or(&[]).to_vec();
        let mut buffer = vec![0; 16 * 1024];
        loop {
            if parse_chunked_body(&bytes).is_ok() {
                break;
            }
            if bytes.len() > LAN_REQUEST_BODY_LIMIT_BYTES {
                return Err("Request body is too large.".to_string());
            }
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => bytes.extend_from_slice(&buffer[..count]),
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock
                    ) =>
                {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    continue;
                }
                Err(error) => return Err(format!("Could not read request body: {error}")),
            }
        }
        return parse_chunked_body(&bytes);
    }
    body_from_request(stream, initial, headers)
}
