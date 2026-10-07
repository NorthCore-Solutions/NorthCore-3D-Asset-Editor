package de.northcore.asseteditor;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "NativeFileDialog")
public class NativeFileDialogPlugin extends Plugin {
    private static final String DIRECTORY_PREFERENCES = "native-project-directory";
    private static final String ROOT_TREE = "root-tree";
    private static final String[] DOCUMENT_COLUMNS = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE
    };

    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String base64 = call.getString("base64");

        if (fileName == null || fileName.isBlank()) {
            call.reject("Dateiname fehlt.");
            return;
        }
        if (base64 == null) {
            call.reject("Dateidaten fehlen.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );

        startActivityForResult(call, intent, "saveFileResult");
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        persistUriPermission(uri, data);

        try {
            writeBase64(uri, call.getString("base64"));
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("uri", uri.toString());
            response.put("name", resolveDisplayName(uri, call.getString("fileName", "Datei")));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Datei konnte nicht gespeichert werden: " + safeMessage(error));
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriValue = call.getString("uri");
        String base64 = call.getString("base64");

        if (uriValue == null || uriValue.isBlank()) {
            call.reject("Dateipfad fehlt.");
            return;
        }
        if (base64 == null) {
            call.reject("Dateidaten fehlen.");
            return;
        }

        try {
            writeBase64(Uri.parse(uriValue), base64);
            call.resolve();
        } catch (Exception error) {
            call.reject("Datei konnte nicht überschrieben werden: " + safeMessage(error));
        }
    }

    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "pickDirectoryResult");
    }

    @ActivityCallback
    private void pickDirectoryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri tree = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || tree == null) {
            JSObject response = new JSObject();
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        try {
            int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            int required = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            if ((flags & required) != required) throw new SecurityException("Bitte Lese- und Schreibzugriff auf den Ordner erlauben.");
            getContext().getContentResolver().takePersistableUriPermission(tree, flags);
            JSObject directory = documentEntry(tree, DocumentsContract.getTreeDocumentId(tree));
            if (!"directory".equals(directory.getString("kind"))) throw new IOException("Die Auswahl ist kein Ordner.");
            getContext().getSharedPreferences(DIRECTORY_PREFERENCES, Context.MODE_PRIVATE).edit()
                .putString(ROOT_TREE, tree.toString()).apply();
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("directory", directory);
            call.resolve(response);
        } catch (Exception error) { rejectDirectoryCall(call, error); }
    }

    @PluginMethod
    public void rememberedDirectory(PluginCall call) {
        String value = getContext().getSharedPreferences(DIRECTORY_PREFERENCES, Context.MODE_PRIVATE).getString(ROOT_TREE, null);
        JSObject response = new JSObject();
        if (value != null) {
            try {
                Uri tree = Uri.parse(value);
                if (!hasTreePermission(tree)) throw new SecurityException("Ordnerfreigabe ist nicht mehr gültig.");
                JSObject entry = documentEntry(tree, DocumentsContract.getTreeDocumentId(tree));
                if (!"directory".equals(entry.getString("kind"))) throw new FileNotFoundException("Ordner nicht mehr vorhanden.");
                response.put("directory", entry);
            } catch (Exception ignored) {
                // Moved/deleted roots and revoked grants return to the normal connect UI.
                forgetDirectory();
            }
        }
        call.resolve(response);
    }

    @PluginMethod
    public void clearRememberedDirectory(PluginCall call) {
        forgetDirectory();
        call.resolve();
    }

    @PluginMethod
    public void directoryPermission(PluginCall call) {
        boolean granted = false;
        try {
            Uri tree = checkedTree(call);
            documentEntry(tree, DocumentsContract.getTreeDocumentId(tree));
            documentEntry(tree, documentId(call));
            granted = true;
        } catch (Exception ignored) { /* The UI offers the tree picker again. */ }
        JSObject response = new JSObject();
        response.put("granted", granted);
        call.resolve(response);
    }

    @PluginMethod
    public void listDirectory(PluginCall call) {
        try {
            Uri tree = checkedTree(call);
            JSObject response = new JSObject();
            response.put("entries", directoryEntries(tree, documentId(call)));
            call.resolve(response);
        } catch (Exception error) { rejectDirectoryCall(call, error); }
    }

    @PluginMethod
    public void getDirectoryFile(PluginCall call) {
        try {
            Uri tree = checkedTree(call);
            String parentId = documentId(call);
            String name = call.getString("name");
            if (name == null || name.isBlank() || name.equals(".") || name.equals("..") || name.contains("/") || name.contains("\\")) {
                throw new IOException("Ungültiger Dateiname.");
            }
            JSArray entries = directoryEntries(tree, parentId);
            JSObject file = null;
            for (int i = 0; i < entries.length(); i++) {
                JSObject entry = JSObject.fromJSONObject(entries.getJSONObject(i));
                if (name.equals(entry.getString("name"))) {
                    if (!"file".equals(entry.getString("kind"))) throw new IOException("Der Name ist bereits durch einen Ordner belegt.");
                    file = entry;
                    break;
                }
            }
            if (file == null) {
                if (!Boolean.TRUE.equals(call.getBoolean("create", false))) throw new FileNotFoundException("Projektdatei nicht gefunden.");
                Uri created = DocumentsContract.createDocument(getContext().getContentResolver(),
                    DocumentsContract.buildDocumentUriUsingTree(tree, parentId), "application/json", name);
                if (created == null) throw new IOException("Datei konnte nicht angelegt werden.");
                file = documentEntry(tree, DocumentsContract.getDocumentId(created));
            }
            JSObject response = new JSObject();
            response.put("file", file);
            call.resolve(response);
        } catch (Exception error) { rejectDirectoryCall(call, error); }
    }

    @PluginMethod
    public void readDocument(PluginCall call) {
        try {
            Uri tree = checkedTree(call);
            Uri document = DocumentsContract.buildDocumentUriUsingTree(tree, documentId(call));
            try (InputStream stream = getContext().getContentResolver().openInputStream(document)) {
                if (stream == null) throw new FileNotFoundException("Projektdatei konnte nicht geöffnet werden.");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int count;
                while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
                JSObject response = new JSObject();
                response.put("base64", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                call.resolve(response);
            }
        } catch (Exception error) { rejectDirectoryCall(call, error); }
    }

    @PluginMethod
    public void writeDocument(PluginCall call) {
        try {
            Uri tree = checkedTree(call);
            writeBase64(DocumentsContract.buildDocumentUriUsingTree(tree, documentId(call)), call.getString("base64"));
            call.resolve();
        } catch (Exception error) { rejectDirectoryCall(call, error); }
    }

    private void forgetDirectory() {
        getContext().getSharedPreferences(DIRECTORY_PREFERENCES, Context.MODE_PRIVATE).edit().remove(ROOT_TREE).apply();
    }

    private boolean hasTreePermission(Uri tree) {
        if (!"content".equals(tree.getScheme()) || !DocumentsContract.isTreeUri(tree)) return false;
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (tree.equals(permission.getUri()) && permission.isReadPermission() && permission.isWritePermission()) return true;
        }
        return false;
    }

    private Uri checkedTree(PluginCall call) {
        String value = call.getString("treeUri");
        if (value == null) throw new SecurityException("Ordnerfreigabe fehlt.");
        Uri tree = Uri.parse(value);
        if (!hasTreePermission(tree)) throw new SecurityException("Ordnerfreigabe ist nicht mehr gültig. Bitte den Hauptordner erneut verbinden.");
        return tree;
    }

    private String documentId(PluginCall call) throws IOException {
        String id = call.getString("documentId");
        if (id == null || id.isBlank()) throw new IOException("Dokument-ID fehlt.");
        return id;
    }

    private JSObject documentEntry(Uri tree, String id) throws IOException {
        try (Cursor cursor = getContext().getContentResolver().query(
            DocumentsContract.buildDocumentUriUsingTree(tree, id), DOCUMENT_COLUMNS, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new FileNotFoundException("Ordner oder Datei ist nicht mehr vorhanden.");
            return cursorEntry(tree, cursor);
        }
    }

    private JSArray directoryEntries(Uri tree, String id) throws IOException {
        if (!"directory".equals(documentEntry(tree, id).getString("kind"))) throw new IOException("Die Auswahl ist kein Ordner.");
        JSArray entries = new JSArray();
        try (Cursor cursor = getContext().getContentResolver().query(
            DocumentsContract.buildChildDocumentsUriUsingTree(tree, id), DOCUMENT_COLUMNS, null, null, null)) {
            if (cursor == null) throw new IOException("Ordner konnte nicht gelesen werden.");
            while (cursor.moveToNext()) entries.put(cursorEntry(tree, cursor));
        }
        return entries;
    }

    private JSObject cursorEntry(Uri tree, Cursor cursor) {
        JSObject entry = new JSObject();
        entry.put("treeUri", tree.toString());
        entry.put("documentId", cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)));
        entry.put("name", cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)));
        entry.put("kind", DocumentsContract.Document.MIME_TYPE_DIR.equals(
            cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE))) ? "directory" : "file");
        return entry;
    }

    private void rejectDirectoryCall(PluginCall call, Exception error) {
        String code = error instanceof SecurityException ? "NotAllowedError" : error instanceof FileNotFoundException ? "NotFoundError" : "DirectoryError";
        call.reject("Projektordner: " + safeMessage(error), code, error);
    }

    private void persistUriPermission(Uri uri, Intent data) {
        int flags = data.getFlags()
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (flags == 0) return;

        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
        } catch (SecurityException ignored) {
            // Manche Dateianbieter gewähren nur eine temporäre Berechtigung.
        }
    }

    private void writeBase64(Uri uri, String base64) throws IOException {
        if (base64 == null) throw new IOException("Dateidaten fehlen.");

        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new IOException("Dateidaten sind ungültig.", error);
        }

        ContentResolver resolver = getContext().getContentResolver();
        OutputStream stream = resolver.openOutputStream(uri, "wt");
        if (stream == null) throw new IOException("Datei konnte nicht geöffnet werden.");

        try (OutputStream output = stream) {
            output.write(bytes);
            output.flush();
        }
    }

    private String resolveDisplayName(Uri uri, String fallback) {
        ContentResolver resolver = getContext().getContentResolver();
        try (Cursor cursor = resolver.query(
            uri,
            new String[] { OpenableColumns.DISPLAY_NAME },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.isBlank()) return name;
                }
            }
        } catch (Exception ignored) {
            // Der gewählte Dateianbieter muss keinen Anzeigenamen liefern.
        }
        return fallback;
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }
}
