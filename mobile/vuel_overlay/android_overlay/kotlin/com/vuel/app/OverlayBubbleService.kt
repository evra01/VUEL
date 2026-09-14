package com.vuel.app

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.Display
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.widget.Toast
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.ImageView
import androidx.core.app.NotificationCompat
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory

/**
 * Service au premier plan qui affiche la bulle flottante par-dessus le jeu
 * (eFootball/CODM) et déclenche la capture d'écran en fin de match.
 *
 * cf. cahier des charges 3.4 — "Sur Android (Bulle Flottante - Overlay) :
 * Activation via SYSTEM_ALERT_WINDOW. Clic sur la bulle en fin de match pour
 * capture, chiffrement et envoi direct au serveur sans passer par la galerie."
 *
 * Nécessite : permission SYSTEM_ALERT_WINDOW déjà accordée (cf. OverlayPermissionService
 * côté Flutter) + une autorisation MediaProjection valide (obtenue une fois via
 * MediaProjectionManager.createScreenCaptureIntent(), le resultCode/data sont transmis
 * ici au démarrage du service).
 */
class OverlayBubbleService : Service() {

    companion object {
        const val CHANNEL_ID = "vuel_overlay_bubble"
        const val NOTIF_ID = 1001
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_DUEL_ID = "duelId"
        const val EXTRA_BASE_URL = "baseUrl"
        const val EXTRA_ACCESS_TOKEN = "accessToken"

        // Opacité de la bulle au repos (non utilisée depuis IDLE_DELAY_MS) —
        // assez faible pour ne pas gêner le jeu en dessous, assez visible
        // pour que l'utilisateur la retrouve facilement en fin de match.
        private const val IDLE_ALPHA = 0.35f
        private const val ACTIVE_ALPHA = 1f
        private const val IDLE_DELAY_MS = 2500L
        private const val FADE_DURATION_MS = 250L

        // Écouté par OverlayBubblePlugin pour relayer le statut à Flutter (EventChannel).
        var statusListener: ((String) -> Unit)? = null
    }

    private lateinit var windowManager: WindowManager
    private var bubbleView: View? = null
    private var mediaProjection: MediaProjection? = null

    // Fondu "inactif" : évite que la bulle ne reste opaque en permanence et ne
    // gêne la vue sur le jeu (eFootball/CODM) pendant qu'on ne s'en sert pas.
    private val idleHandler = Handler(Looper.getMainLooper())
    private val idleFadeRunnable = Runnable { fadeBubbleTo(IDLE_ALPHA) }
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureWidth: Int = 0
    private var captureHeight: Int = 0

    private var duelId: String = ""
    private var baseUrl: String = ""
    private var accessToken: String = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        duelId = intent?.getStringExtra(EXTRA_DUEL_ID) ?: ""
        baseUrl = intent?.getStringExtra(EXTRA_BASE_URL) ?: ""
        accessToken = intent?.getStringExtra(EXTRA_ACCESS_TOKEN) ?: ""

        startForegroundWithNotification()

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        val resultData = intent?.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
        if (resultData != null) {
            setupMediaProjection(resultCode, resultData)
        }

        showBubble()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        removeBubble()
        releaseCaptureSurface()
        mediaProjection?.stop()
    }

    // --- Notification premier plan (obligatoire dès Android 8+ pour un service longue durée) ---
    private fun startForegroundWithNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Vuel - Duel en cours", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Vuel")
            .setContentText("Duel en cours — appuie sur la bulle en fin de match")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .build()
        startForeground(NOTIF_ID, notification)
    }

    // --- Bulle flottante ---
    private fun showBubble() {
        // BUG CORRIGÉ ICI (symptôme signalé : "à chaque nouveau duel, une
        // bulle différente se crée, plusieurs bulles s'affichent à l'écran").
        // Ce service est un Service Android classique (pas un composant par
        // duel) : quand un 2e duel démarre, startForegroundService() ne crée
        // PAS une nouvelle instance — il redélivre juste un nouvel intent à
        // l'instance déjà en cours via onStartCommand(), qui rappelait
        // showBubble() sans jamais retirer l'ancienne vue. windowManager.addView()
        // empilait donc une bulle supplémentaire à chaque duel, au lieu de
        // remplacer la précédente. Fix : on retire systématiquement toute
        // bulle existante avant d'en ajouter une nouvelle, ce qui rend
        // showBubble() idempotent quel que soit le nombre d'appels.
        removeBubble()

        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager

        val layoutFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

        // Taille fixée directement en pixels au niveau de la fenêtre système
        // plutôt que WRAP_CONTENT + dimensions XML — plus fiable : WRAP_CONTENT
        // dépend de la mesure de la vue racine sans parent, ce qui s'est avéré
        // ne pas toujours donner la taille attendue en pratique (bulle bien
        // plus grande que prévu constatée malgré layout_width="64dp" en XML).
        val bubbleSizePx = (64 * resources.displayMetrics.density).toInt()
        val params = WindowManager.LayoutParams(
            bubbleSizePx,
            bubbleSizePx,
            layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        )
        params.gravity = Gravity.TOP or Gravity.START
        params.x = 0
        params.y = 200

        // Bulle habillée : cercle sombre + anneau ambre + logo Vuel découpé en
        // rond. On force une taille de bitmap exacte en pixels (indépendante
        // de la densité de l'écran) plutôt que de laisser BitmapFactory
        // appliquer sa mise à l'échelle automatique par densité — sans ça, sur
        // un écran haute densité (xxhdpi/xxxhdpi, la majorité des téléphones
        // récents), l'image dans res/drawable/ (bucket mdpi par défaut, faute
        // de dossier qualifié par densité) est agrandie bien au-delà de la
        // taille voulue, d'où la bulle géante constatée.
        bubbleView = LayoutInflater.from(this).inflate(R.layout.overlay_bubble, null).apply {
            val logoView = findViewById<ImageView>(R.id.bubble_logo)
            val targetPx = (56 * resources.displayMetrics.density).toInt() // correspond à la zone dispo dans le layout (64dp - 2*4dp padding)

            val options = BitmapFactory.Options().apply { inScaled = false }
            val rawBitmap = BitmapFactory.decodeResource(resources, R.drawable.vuel_bubble_logo, options)
            val exactSizeBitmap = android.graphics.Bitmap.createScaledBitmap(rawBitmap, targetPx, targetPx, true)

            val rounded = RoundedBitmapDrawableFactory.create(resources, exactSizeBitmap).apply {
                isCircular = true
            }
            logoView.setImageDrawable(rounded)

            // Ombre portée circulaire plutôt que le rectangle par défaut de la
            // vue racine (sinon l'ombre "dépasse" visuellement du cercle).
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: android.graphics.Outline) {
                    outline.setOval(0, 0, view.width, view.height)
                }
            }
            clipToOutline = true

            // Bulle pleinement visible tant qu'on ne l'a pas laissée au repos
            // — l'estompage ne démarre qu'après IDLE_DELAY_MS sans interaction.
            alpha = ACTIVE_ALPHA

            setOnTouchListener(
                BubbleDragTouchListener(
                    windowManager, params, this,
                    onTap = { onBubbleTapped() },
                    onInteractionStart = { wakeUpBubble() },
                ),
            )
        }

        // Filet de sécurité : si la permission overlay a été révoquée entre le
        // moment où on l'a vérifiée (OverlayBubblePlugin) et maintenant (ex:
        // l'utilisateur va dans les réglages pendant que le service tourne),
        // addView lève une SecurityException. On le rattrape pour arrêter
        // proprement le service plutôt que de crasher silencieusement.
        try {
            windowManager.addView(bubbleView, params)
            scheduleIdleFade()
        } catch (e: SecurityException) {
            postStatus("overlay_permission_missing")
            stopSelf()
        }
    }

    private fun removeBubble() {
        idleHandler.removeCallbacks(idleFadeRunnable)
        bubbleView?.let { windowManager.removeView(it) }
        bubbleView = null
    }

    // --- Estompage de la bulle au repos ---

    // (Re)démarre le compte à rebours avant estompage — appelé après chaque
    // interaction pour repousser le moment où la bulle redevient discrète.
    private fun scheduleIdleFade() {
        idleHandler.removeCallbacks(idleFadeRunnable)
        idleHandler.postDelayed(idleFadeRunnable, IDLE_DELAY_MS)
    }

    // Remet immédiatement la bulle à pleine opacité (appelé dès qu'on la
    // touche) puis reprogramme l'estompage pour la prochaine période d'inactivité.
    private fun wakeUpBubble() {
        fadeBubbleTo(ACTIVE_ALPHA)
        scheduleIdleFade()
    }

    private fun fadeBubbleTo(targetAlpha: Float) {
        bubbleView?.animate()
            ?.alpha(targetAlpha)
            ?.setDuration(FADE_DURATION_MS)
            ?.start()
    }

    private fun onBubbleTapped() {
        showToast("📸 Capture en cours…")
        postStatus("capturing")
        try {
            captureScreen { bitmapBytes ->
                if (bitmapBytes == null) {
                    showToast("❌ Échec de la capture — réessaie")
                    postStatus("capture_failed")
                    return@captureScreen
                }
                postStatus("uploading")
                CaptureUploader.encryptAndUpload(
                    context = this,
                    duelId = duelId,
                    baseUrl = baseUrl,
                    accessToken = accessToken,
                    imageBytes = bitmapBytes,
                ) { success ->
                    // Le callback d'OkHttp (enqueue) s'exécute sur un thread
                    // du pool interne d'OkHttp, PAS sur le thread principal.
                    // statusListener relaie vers Flutter via un EventChannel,
                    // qui exige d'être invoqué depuis le thread UI — l'appeler
                    // ici directement levait une exception non rattrapée sur
                    // ce thread (donc invisible au try/catch ci-dessous) et
                    // faisait planter tout le process. postStatus() repasse
                    // systématiquement par le thread principal.
                    showToast(if (success) "✅ Preuve envoyée" else "❌ Échec de l'envoi — réessaie")
                    postStatus(if (success) "uploaded" else "upload_failed")
                }
            }
        } catch (e: Exception) {
            // Ce service tourne dans le même process que l'app (pas de
            // android:process séparé) — une exception non rattrapée ici
            // ferait planter TOUTE l'application, pas juste la capture.
            // Mieux vaut échouer proprement et laisser l'utilisateur réessayer.
            // On logue la vraie cause (visible via `adb logcat`) — sans ça,
            // toute panne de capture remonte comme le même message générique
            // et devient impossible à diagnostiquer à distance.
            Log.e("VuelBubble", "Échec de la capture d'écran", e)
            showToast("❌ Échec de la capture — réessaie")
            postStatus("capture_failed")
        }
    }

    // Relaie un statut vers Flutter (EventChannel) — TOUJOURS depuis le
    // thread principal, quel que soit le thread appelant. Voir le commentaire
    // dans onBubbleTapped : le callback d'upload OkHttp est un cas concret où
    // l'appel direct plantait l'app.
    private fun postStatus(status: String) {
        Handler(Looper.getMainLooper()).post {
            statusListener?.invoke(status)
        }
    }

    // Un Toast s'affiche par-dessus n'importe quelle app au premier plan (le
    // jeu en cours, pas seulement Vuel) — indispensable ici puisque la bulle
    // est tapée pendant qu'on joue, pas depuis l'écran de duel de l'app.
    // Toast.makeText doit être appelé depuis le thread principal.
    private fun showToast(message: String) {
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        }
    }

    // --- Capture via MediaProjection ---
    private fun setupMediaProjection(resultCode: Int, resultData: Intent) {
        // Même cause que le bug des bulles multipliées (voir showBubble) : si
        // un duel précédent avait déjà armé une MediaProjection sur cette
        // même instance de service (ex: le joueur enchaîne un 2e duel sans
        // que le service ait été stoppé entre-temps), on écrasait ici
        // `mediaProjection` par la nouvelle sans jamais libérer/arrêter
        // l'ancienne — VirtualDisplay/ImageReader/MediaProjection de l'ancien
        // duel restaient ouverts indéfiniment (fuite). On nettoie donc
        // systématiquement l'ancienne session avant d'en armer une nouvelle.
        releaseCaptureSurface()
        mediaProjection?.stop()

        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = manager.getMediaProjection(resultCode, resultData)

        // Depuis Android 14 (API 34), le système exige qu'un callback soit
        // enregistré sur le MediaProjection AVANT le moindre appel à
        // createVirtualDisplay() — sans ça, createVirtualDisplay lève une
        // exception (rattrapée plus haut par le catch générique dans
        // onBubbleTapped, d'où le "Échec de la capture" alors que tout le
        // reste — permissions, service, bulle — fonctionne correctement).
        // cf. https://developer.android.com/about/versions/14/behavior-changes-14#screen-capture
        mediaProjection?.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                // Le système (ou l'utilisateur, via la notif de capture) a
                // coupé la projection : on nettoie pour éviter toute fuite/
                // tentative d'usage d'un VirtualDisplay devenu invalide.
                releaseCaptureSurface()
                mediaProjection = null
            }
        }, Handler(Looper.getMainLooper()))

        // BUG CORRIGÉ ICI (symptôme signalé : "la 1ère capture part, toutes
        // les suivantes échouent") : le VirtualDisplay + l'ImageReader étaient
        // recréés PUIS release()/close() à chaque capture (voir l'ancienne
        // version de captureScreen). Or depuis Android 14, libérer le
        // VirtualDisplay associé à une MediaProjection arrête AUTOMATIQUEMENT
        // la projection elle-même (le onStop() ci-dessus se déclenche juste
        // après le premier release()), ce qui met `mediaProjection` à null —
        // d'où l'échec silencieux de toutes les captures suivantes (cf. le
        // early-return "projection == null" dans captureScreen).
        // cf. https://developer.android.com/about/versions/14/behavior-changes-14#screen-capture-stop
        // Fix : créer le VirtualDisplay/ImageReader UNE SEULE FOIS pour toute
        // la durée du duel, et ne plus jamais les release()/close() entre deux
        // captures — seul le listener "one-shot" est ré-attaché à chaque tap
        // sur la bulle (voir captureScreen). Ils ne sont libérés qu'à l'arrêt
        // du service (onDestroy) ou si le système coupe la projection (onStop
        // ci-dessus).
        setupCaptureSurface()
    }

    private fun setupCaptureSurface() {
        val projection = mediaProjection ?: return

        // windowManager.defaultDisplay lève UnsupportedOperationException depuis
        // Android 11 quand appelé depuis un contexte non-visuel comme un Service
        // (ce qui faisait planter TOUT le process app, vu que ce service tourne
        // in-process — cf. AndroidManifest_service.xml, pas de android:process
        // séparé). DisplayManager n'a pas cette restriction.
        val displayManager = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val display = displayManager.getDisplay(Display.DEFAULT_DISPLAY)
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        display.getRealMetrics(metrics)
        captureWidth = metrics.widthPixels
        captureHeight = metrics.heightPixels

        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2)
        virtualDisplay = projection.createVirtualDisplay(
            "VuelCapture",
            captureWidth, captureHeight, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface, null, null,
        )
    }

    private fun releaseCaptureSurface() {
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.setOnImageAvailableListener(null, null)
        imageReader?.close()
        imageReader = null
    }

    // Capture d'un seul frame sur le VirtualDisplay/ImageReader déjà ouverts
    // (mis en place une fois pour toutes dans setupCaptureSurface — voir le
    // commentaire dans setupMediaProjection pour le bug que ça corrige). On
    // se contente ici d'attacher un listener "one-shot" pour récupérer le
    // prochain frame, sans jamais recréer ni libérer le VirtualDisplay.
    private fun captureScreen(onResult: (ByteArray?) -> Unit) {
        val reader = imageReader
        if (mediaProjection == null || reader == null) {
            onResult(null)
            return
        }
        val width = captureWidth
        val height = captureHeight

        val resolved = java.util.concurrent.atomic.AtomicBoolean(false)
        val timeoutHandler = Handler(Looper.getMainLooper())
        val timeoutRunnable = Runnable {
            if (resolved.compareAndSet(false, true)) {
                Log.e("VuelBubble", "Timeout capture — aucun frame reçu de MediaProjection")
                reader.setOnImageAvailableListener(null, null)
                onResult(null)
            }
        }

        reader.setOnImageAvailableListener({ r ->
            if (!resolved.compareAndSet(false, true)) return@setOnImageAvailableListener
            timeoutHandler.removeCallbacks(timeoutRunnable)
            // Détache le listener one-shot tout de suite — le VirtualDisplay et
            // l'ImageReader eux restent ouverts pour la prochaine capture.
            r.setOnImageAvailableListener(null, null)
            val image = r.acquireLatestImage()
            if (image == null) {
                onResult(null)
                return@setOnImageAvailableListener
            }
            val bytes = ImageUtils.imageToPngBytes(image, width, height)
            image.close()
            onResult(bytes)
        }, Handler(Looper.getMainLooper()))

        timeoutHandler.postDelayed(timeoutRunnable, 3000L)
    }
}
