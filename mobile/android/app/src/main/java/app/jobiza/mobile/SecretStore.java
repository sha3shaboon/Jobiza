package app.jobiza.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/**
 * Keys made on first run (the auth secret, the key that encrypts the Anthropic
 * API key at rest, and the local account's password), stored encrypted with a
 * key that never leaves the Android Keystore.
 */
final class SecretStore {

    private static final String TAG = "Jobiza";
    private static final String ALIAS = "jobiza_secrets";
    private static final String PREFS = "jobiza";
    private static final String FIELD = "secrets";

    private SecretStore() {}

    static JSONObject load(Context ctx) throws Exception {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String blob = prefs.getString(FIELD, null);
        if (blob != null) {
            try {
                return new JSONObject(decrypt(blob));
            } catch (Exception e) {
                // Without the old key, a saved Anthropic key can't be read; the user re-enters it.
                Log.w(TAG, "Stored secrets unreadable, making new ones", e);
            }
        }
        JSONObject fresh = new JSONObject();
        fresh.put("authSecret", random(32, false));
        fresh.put("encryptionKey", random(32, false));
        fresh.put("localPassword", random(32, true));
        prefs.edit().putString(FIELD, encrypt(fresh.toString())).apply();
        return fresh;
    }

    private static String random(int bytes, boolean hex) {
        byte[] b = new byte[bytes];
        new SecureRandom().nextBytes(b);
        if (!hex) return Base64.encodeToString(b, Base64.NO_WRAP);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return gen.generateKey();
    }

    private static String encrypt(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    private static String decrypt(String blob) throws Exception {
        String[] parts = blob.split(":", 2);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
