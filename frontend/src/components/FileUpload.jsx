import React from 'react';
// I installed 'lucide-react' and 'axios'. I did NOT install 'react-dropzone'.
// I should probably install it or build a simple one. The user asked for "PDF upload (drag & drop)".
// A simple drag & drop implementation without library is doable but 'react-dropzone' is standard.
// I will create a simple drag and drop implementation to avoid another install if possible, OR I'll add the install command.
// I'll add the install command to the next batch or assume I can do it.
// Let's implement a custom one to be dependency-lite or just use standard input for now and improve later?
// No, user specifically asked for Drag & Drop. I'll implement a clean custom one.

import { Upload } from 'lucide-react';

const FileUpload = ({ onUpload, isProcessing }) => {
    const [dragActive, setDragActive] = React.useState(false);
    const inputRef = React.useRef(null);

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onUpload(Array.from(e.dataTransfer.files));
        }
    };

    const handleChange = (e) => {
        e.preventDefault();
        if (e.target.files && e.target.files.length > 0) {
            onUpload(Array.from(e.target.files));
        }
    };

    const onButtonClick = () => {
        inputRef.current.click();
    };

    return (
        <div
            className={`upload-container ${dragActive ? "drag-active" : ""}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
        >
            <input
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf"
                className="file-input-hidden"
                onChange={handleChange}
            />

            <div className="upload-content">
                <div className="icon-wrapper">
                    {isProcessing ? (
                        <div className="spinner"></div> // CSS spinner
                    ) : (
                        <Upload size={48} className="text-primary" />
                    )}
                </div>

                <h3>
                    {isProcessing ? "Processing..." : "Drop payroll PDFs here"}
                </h3>
                <p>or select files</p>
                <button
                    type="button"
                    className="btn-primary"
                    onClick={onButtonClick}
                    disabled={isProcessing}
                >
                    Select Files
                </button>
                <p className="mt-2 text-sm text-gray">
                    Multiple files supported
                </p>
            </div>
        </div>
    );
};

export default FileUpload;
