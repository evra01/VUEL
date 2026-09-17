package com.vuel.app

import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager

/**
 * Permet de déplacer la bulle à l'écran, et distingue un drag d'un simple tap
 * (déclenche onTap uniquement si le mouvement est négligeable).
 */
class BubbleDragTouchListener(
    private val windowManager: WindowManager,
    private val params: WindowManager.LayoutParams,
    private val view: View,
    private val onTap: () -> Unit,
    // Appelé dès qu'on touche/déplace la bulle — sert à la sortir de son état
    // semi-transparent "inactif" (cf. OverlayBubbleService.wakeUpBubble) avant
    // même de savoir si le geste est un tap ou un drag.
    private val onInteractionStart: () -> Unit = {},
) : View.OnTouchListener {

    // Seuil recommandé par le système (adapté à la densité de l'écran) plutôt
    // qu'une valeur fixe en pixels bruts — un seuil fixe de 10px "bruts"
    // s'est avéré trop strict sur les écrans haute densité : un simple tap
    // avec un léger tremblement de la main dépassait le seuil et n'était
    // donc jamais reconnu comme un tap (la capture ne se déclenchait jamais).
    private val touchSlop = ViewConfiguration.get(view.context).scaledTouchSlop

    private var initialX = 0
    private var initialY = 0
    private var initialTouchX = 0f
    private var initialTouchY = 0f
    private var moved = false

    override fun onTouch(v: View, event: MotionEvent): Boolean {
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                initialX = params.x
                initialY = params.y
                initialTouchX = event.rawX
                initialTouchY = event.rawY
                moved = false
                onInteractionStart()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = event.rawX - initialTouchX
                val dy = event.rawY - initialTouchY
                if (kotlin.math.abs(dx) > touchSlop || kotlin.math.abs(dy) > touchSlop) moved = true
                params.x = initialX + dx.toInt()
                params.y = initialY + dy.toInt()
                windowManager.updateViewLayout(view, params)
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (!moved) onTap()
                return true
            }
        }
        return false
    }
}
