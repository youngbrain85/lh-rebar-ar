import Foundation

struct RebarModel: Identifiable, Hashable {
    let id: String
    let displayName: String
    let resourceName: String
    let subpath: String?
    /// When set, the model is loaded from this on-disk file (e.g. a USDZ
    /// downloaded from the backend) instead of the app bundle.
    var localURL: URL? = nil
    /// Backend site this model belongs to — used to join the per-site live
    /// collaboration room (`site-<id>`). nil for bundled sample models.
    var siteID: Int? = nil
}
