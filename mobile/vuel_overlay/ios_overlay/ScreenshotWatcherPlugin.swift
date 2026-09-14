import Flutter
import UIKit
import Photos

/**
 * iOS ne permet pas de bulle flottante ni de capture d'écran par une app tierce.
 * Le flux retenu (cf. cahier des charges 3.4) : on écoute la notification système
 * `userDidTakeScreenshotNotification` pendant qu'un duel est actif, on envoie une
 * notification locale invitant le joueur à confirmer l'envoi, puis on va chercher
 * la dernière capture dans la photothèque (avec un contrôle d'horodatage pour
 * éviter d'envoyer une vieille capture) et on l'upload directement au serveur.
 */
public class ScreenshotWatcherPlugin: NSObject, FlutterPlugin {
    private var methodChannel: FlutterMethodChannel!
    private var eventChannel: FlutterEventChannel!
    private var eventSink: FlutterEventSink?

    private var isWatching = false
    private var watchStartedAt: Date?
    private var duelId = ""
    private var baseUrl = ""
    private var accessToken = ""

    public static func register(with registrar: FlutterPluginRegistrar) {
        let instance = ScreenshotWatcherPlugin()
        instance.methodChannel = FlutterMethodChannel(name: "vuel/screenshot_watcher", binaryMessenger: registrar.messenger())
        instance.eventChannel = FlutterEventChannel(name: "vuel/screenshot_watcher/status", binaryMessenger: registrar.messenger())
        registrar.addMethodCallDelegate(instance, channel: instance.methodChannel)
        instance.eventChannel.setStreamHandler(instance)
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "startWatching":
            guard let args = call.arguments as? [String: String] else { result(false); return }
            duelId = args["duelId"] ?? ""
            baseUrl = args["baseUrl"] ?? ""
            accessToken = args["accessToken"] ?? ""
            startWatching()
            result(true)
        case "stopWatching":
            stopWatching()
            result(nil)
        case "confirmSend":
            fetchAndUploadLatestScreenshot()
            result(nil)
        default:
            result(FlutterMethodNotImplemented)
        }
    }

    private func startWatching() {
        guard !isWatching else { return }
        isWatching = true
        watchStartedAt = Date()
        NotificationCenter.default.addObserver(
            self, selector: #selector(onScreenshotTaken),
            name: UIApplication.userDidTakeScreenshotNotification, object: nil,
        )
    }

    private func stopWatching() {
        isWatching = false
        NotificationCenter.default.removeObserver(self, name: UIApplication.userDidTakeScreenshotNotification, object: nil)
    }

    @objc private func onScreenshotTaken() {
        eventSink?("screenshot_detected")
        // Notification locale invitant l'utilisateur à confirmer l'envoi — évite d'accéder
        // à la photothèque sans action explicite (cohérent avec les règles de confidentialité iOS).
        scheduleLocalNotification()
    }

    private func scheduleLocalNotification() {
        let content = UNMutableNotificationContent()
        content.title = "Capture détectée"
        content.body = "Appuie ici pour envoyer ton score à Vuel."
        content.userInfo = ["duelId": duelId]
        let request = UNNotificationRequest(identifier: "vuel_screenshot_\(UUID().uuidString)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /// Appelé depuis Flutter quand l'utilisateur confirme l'envoi (tap sur la notification
    /// ou bouton dans l'app). Récupère la capture la plus récente avec contrôle d'horodatage.
    private func fetchAndUploadLatestScreenshot() {
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = 1

        let result = PHAsset.fetchAssets(with: .image, options: options)
        guard let asset = result.firstObject, let createdAt = asset.creationDate else { return }

        // Rejette toute capture antérieure au début de la surveillance (anti-triche basique).
        guard let start = watchStartedAt, createdAt >= start else {
            eventSink?("stale_screenshot_rejected")
            return
        }

        let manager = PHImageManager.default()
        let requestOptions = PHImageRequestOptions()
        requestOptions.isSynchronous = false
        requestOptions.deliveryMode = .highQualityFormat

        manager.requestImageDataAndOrientation(for: asset, options: requestOptions) { data, _, _, _ in
            guard let data = data else { self.eventSink?("capture_failed"); return }
            self.upload(data: data)
        }
    }

    private func upload(data: Data) {
        eventSink?("uploading")
        guard let url = URL(string: "\(baseUrl)/duels/\(duelId)/proof") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"proof.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        URLSession.shared.dataTask(with: request) { _, response, error in
            let success = error == nil && (response as? HTTPURLResponse)?.statusCode ?? 500 < 300
            DispatchQueue.main.async {
                self.eventSink?(success ? "uploaded" : "upload_failed")
            }
        }.resume()
    }
}

extension ScreenshotWatcherPlugin: FlutterStreamHandler {
    public func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
        eventSink = events
        return nil
    }
    public func onCancel(withArguments arguments: Any?) -> FlutterError? {
        eventSink = nil
        return nil
    }
}
