import Foundation

/// Backend connection settings for the BriconLab analysis API.
///
/// Note: the Postman collection's `https://api.briconlab.com` (port 443) is
/// unreachable — the live host is plain HTTP on port 50001. Calling it from iOS
/// requires an App Transport Security exception for this domain (see the
/// `NSAppTransportSecurity` block in Info.plist / project.yml).
enum BackendConfig {
    static let baseURL = URL(string: "http://api.briconlab.com:50001")!
}
