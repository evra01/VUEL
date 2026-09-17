package com.vuel.app

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import java.io.IOException

/**
 * Envoie la capture directement au serveur, sans passer par la galerie (cf. cahier
 * des charges 3.4). Le transport est chiffré via HTTPS/TLS (à activer côté déploiement
 * du back-end) — c'est ce chiffrement-là qui protège la capture en transit.
 *
 * NOTE IMPORTANTE : une tentative initiale chiffrait le fichier avec une clé
 * Android Keystore non exportable avant l'envoi, mais cela rend le contenu illisible
 * côté serveur — or le pipeline OCR (Google Cloud Vision) a besoin de l'image en clair
 * pour analyser le score. Un vrai chiffrement de bout en bout demanderait que le
 * back-end fournisse une clé (ex: clé publique RSA ou clé de session par duel) que le
 * client utilise pour chiffrer, et que le serveur déchiffre avant l'appel OCR.
 * TODO: si ce chiffrement applicatif est requis par la conformité, ajouter un endpoint
 * `GET /duels/:id/proof-key` côté back-end et l'utiliser ici avant l'upload.
 */
object CaptureUploader {
    private val client = OkHttpClient()

    fun encryptAndUpload(
        context: android.content.Context,
        duelId: String,
        baseUrl: String,
        accessToken: String,
        imageBytes: ByteArray,
        onComplete: (Boolean) -> Unit,
    ) {
        upload(duelId, baseUrl, accessToken, imageBytes, onComplete)
    }

    private fun upload(
        duelId: String,
        baseUrl: String,
        accessToken: String,
        imageBytes: ByteArray,
        onComplete: (Boolean) -> Unit,
    ) {
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "file", "proof.png",
                RequestBody.create("image/png".toMediaTypeOrNull(), imageBytes),
            )
            .build()

        val request = Request.Builder()
            .url("$baseUrl/duels/$duelId/proof")
            .addHeader("Authorization", "Bearer $accessToken")
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            // Ce callback s'exécute sur un thread du pool interne d'OkHttp,
            // pas sur le thread principal. Toute exception non rattrapée ici
            // (y compris dans onComplete côté appelant) tue le process entier
            // puisqu'il n'y a pas de handler d'exceptions sur ce thread — d'où
            // le try/catch, en plus des précautions déjà prises côté appelant
            // pour repasser sur le thread principal avant de toucher Flutter/UI.
            override fun onFailure(call: Call, e: IOException) {
                try { onComplete(false) } catch (t: Throwable) { }
            }
            override fun onResponse(call: Call, response: Response) {
                try {
                    onComplete(response.isSuccessful)
                } catch (t: Throwable) {
                } finally {
                    response.close()
                }
            }
        })
    }
}

