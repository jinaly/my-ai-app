import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";

export default function DocumentUploader({ onDocumentUploaded }) {
  const [uploading, setUploading] = useState(false);
  // Stores only the currently active document
  const [activeDocument, setActiveDocument] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);

  const onDrop = useCallback(
    async (acceptedFiles) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setUploading(true);
      setStatusMessage(null);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("http://localhost:8000/api/documents/upload", {
          method: "POST",
          body: formData,
        });

        const result = await res.json();
        if (res.ok && result.status === "success") {
          setStatusMessage({
            type: "success",
            text: `Indexed "${file.name}" (${result.total_chunks} chunk${
              result.total_chunks > 1 ? "s" : ""
            })`,
          });

          // Overwrite with only the most recently uploaded file
          setActiveDocument(file.name);

          if (onDocumentUploaded) onDocumentUploaded(file.name);
        } else {
          setStatusMessage({
            type: "error",
            text: result.message || "Upload failed",
          });
        }
      } catch (err) {
        console.log(err);
        setStatusMessage({
          type: "error",
          text: "Network error uploading file.",
        });
      } finally {
        setUploading(false);
      }
    },
    [onDocumentUploaded]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "text/plain": [".txt"],
    },
    maxFiles: 1,
  });

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-slate-200">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-5 flex flex-col items-center justify-center cursor-pointer transition-colors ${
          isDragActive
            ? "border-indigo-500 bg-indigo-500/10"
            : "border-slate-700 hover:border-slate-500 bg-slate-800/30"
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-center py-2">
            <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
            <p className="text-xs text-slate-400">
              Embedding & indexing into ChromaDB...
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center py-2">
            <UploadCloud className="w-6 h-6 text-indigo-400" />
            <p className="text-xs font-medium text-slate-300">
              {isDragActive
                ? "Drop file here"
                : "Drop a PDF or .txt file here, or browse"}
            </p>
            <p className="text-[10px] text-slate-500">
              Max 10MB • Auto-indexed into vector memory
            </p>
          </div>
        )}
      </div>

      {statusMessage && (
        <div
          className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
            statusMessage.type === "success"
              ? "bg-emerald-950/60 text-emerald-300 border border-emerald-800/80"
              : "bg-rose-950/60 text-rose-300 border border-rose-800/80"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span className="truncate">{statusMessage.text}</span>
        </div>
      )}

      {activeDocument && (
        <div className="mt-4 pt-3 border-t border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-2">
            Active Document
          </span>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-slate-800 text-slate-300 border border-slate-700/80">
              <FileText className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
              <span className="truncate max-w-[200px]">{activeDocument}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
