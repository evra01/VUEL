package com.vuel.app

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.provider.Settings
import androidx.annotation.NonNull
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Expose à Flutter :
 *  - method "requestMediaProjection" : ouvre le dialog système de capture d'écran (une fois par session)
 *  - method "startBubble" / "stopBubble" : démarre/arrête OverlayBubbleService
 *  - event stream "capture_status" : relaie "capturing" / "uploading" / "uploaded" / "upload_failed"
 */
class OverlayBubblePlugin : FlutterPlugin, ActivityAware, MethodChannel.MethodCallHandler {

    private lateinit var methodChannel: MethodChannel
    private lateinit var eventChannel: EventChannel
    private var activity: Activity? = null
    private var pendingResult: MethodChannel.Result? = null

    private var pendingDuelId: String = ""
    private var pendingBaseUrl: String = ""
    private var pendingAccessToken: String = ""

    companion object {
        const val REQUEST_CODE_MEDIA_PROJECTION = 4242
    }

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        methodChannel = MethodChannel(binding.binaryMessenger, "vuel/overlay_bubble")
        methodChannel.setMethodCallHandler(this)

        eventChannel = EventChannel(binding.binaryMessenger, "vuel/overlay_bubble/status")
        eventChannel.setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
                OverlayBubbleService.statusListener = { status -> events.success(status) }
            }
            override fun onCancel(arguments: Any?) {
                OverlayBubbleService.statusListener = null
            }
        })
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        methodChannel.setMethodCallHandler(null)
        eventChannel.setStreamHandler(null)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "requestMediaProjection" -> {
                val act = activity
                // La bulle a besoin de DEUX permissions distinctes : SYSTEM_ALERT_WINDOW
                // (overlay, gérée en amont dans DeviceSetupScreen) et MediaProjection
                // (demandée ici). Sans la première, windowManager.addView() plante
                // silencieusement plus tard dans OverlayBubbleService — donc on vérifie
                // AVANT de lancer le flow MediaProjection, pour échouer proprement ici
                // avec un message exploitable côté Flutter plutôt qu'un échec muet.
                if (act != null && !Settings.canDrawOverlays(act)) {
                    result.error(
                        "OVERLAY_PERMISSION_MISSING",
                        "Autorise d'abord \"Affichage par-dessus les autres applications\" dans Profil > Configuration de l'appareil.",
                        null,
                    )
                    return
                }
                pendingDuelId = call.argument<String>("duelId") ?: ""
                pendingBaseUrl = call.argument<String>("baseUrl") ?: ""
                pendingAccessToken = call.argument<String>("accessToken") ?: ""
                pendingResult = result
                requestMediaProjection()
            }
            "stopBubble" -> {
                activity?.stopService(Intent(activity, OverlayBubbleService::class.java))
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun requestMediaProjection() {
        val act = activity ?: run { pendingResult?.error("NO_ACTIVITY", "Activity indisponible", null); return }
        val manager = act.getSystemService(Activity.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        act.startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CODE_MEDIA_PROJECTION)
    }

    // Appelé depuis MainActivity.onActivityResult (cf. patch requis, voir README)
    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != REQUEST_CODE_MEDIA_PROJECTION) return false

        if (resultCode == Activity.RESULT_OK && data != null) {
            val serviceIntent = Intent(activity, OverlayBubbleService::class.java).apply {
                putExtra(OverlayBubbleService.EXTRA_RESULT_CODE, resultCode)
                putExtra(OverlayBubbleService.EXTRA_RESULT_DATA, data)
                putExtra(OverlayBubbleService.EXTRA_DUEL_ID, pendingDuelId)
                putExtra(OverlayBubbleService.EXTRA_BASE_URL, pendingBaseUrl)
                putExtra(OverlayBubbleService.EXTRA_ACCESS_TOKEN, pendingAccessToken)
            }
            activity?.startForegroundService(serviceIntent)
            pendingResult?.success(true)
        } else {
            pendingResult?.success(false)
        }
        pendingResult = null
        return true
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
        binding.addActivityResultListener { requestCode, resultCode, data ->
            handleActivityResult(requestCode, resultCode, data)
        }
    }
    override fun onDetachedFromActivityForConfigChanges() { activity = null }
    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) { onAttachedToActivity(binding) }
    override fun onDetachedFromActivity() { activity = null }
}
