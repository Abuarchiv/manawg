'use client';

import { useRef, useState } from 'react';
import { MAX_CSV_BYTES } from '@/features/expenses/import-body';
import { OcrInitializationError, runOcrOnImage } from '@/features/expenses/ocr';
import type { Message } from '@/shared/i18n/message';
import { decodeCsv, type ImportInputStatus, MAX_IMAGE_BYTES } from './import-wizard-types';

interface ImportInputCallbacks {
	/** The input is gone: drop everything derived from it and reset the import options. */
	onInputDiscarded: () => void;
	/** The input was edited by hand: drop everything derived from it. */
	onInputEdited: () => void;
	setError: (message: Message) => void;
	clearError: () => void;
}

/**
 * The wizard's input step: a CSV file, a screenshot run through OCR, or pasted text.
 * Each replacement bumps a run id, so a file read or OCR run still in flight discards
 * its late result instead of overwriting newer input.
 */
export function useImportInput({
	onInputDiscarded,
	onInputEdited,
	setError,
	clearError,
}: ImportInputCallbacks) {
	const [rawPayload, setRawPayload] = useState('');
	const [ocrText, setOcrText] = useState('');
	const [ocrRunning, setOcrRunning] = useState(false);
	const [inputStatus, setInputStatus] = useState<ImportInputStatus>('empty');
	const [pickedFileName, setPickedFileName] = useState<string | null>(null);
	const inputRunIdRef = useRef(0);

	function discardInput(): number {
		const runId = inputRunIdRef.current + 1;
		inputRunIdRef.current = runId;
		setRawPayload('');
		setOcrText('');
		setOcrRunning(false);
		onInputDiscarded();
		return runId;
	}

	function beginInputReplacement(): number {
		const runId = discardInput();
		setInputStatus('reading');
		clearError();
		return runId;
	}

	/** Back to an empty input, as when another source is chosen. */
	function resetInput(): void {
		discardInput();
		setPickedFileName(null);
		setInputStatus('empty');
	}

	function setManualPayload(value: string): void {
		inputRunIdRef.current += 1;
		setRawPayload(value);
		setOcrText(value);
		onInputEdited();
		setInputStatus(value.trim() ? 'ready' : 'empty');
		clearError();
	}

	async function handleOcrFile(file: File): Promise<void> {
		const runId = beginInputReplacement();
		if (file.size > MAX_IMAGE_BYTES) {
			setPickedFileName(null);
			setInputStatus('error');
			setError({ key: 'expenses-import.input.errors.imageTooLarge' });
			setOcrRunning(false);
			return;
		}
		setPickedFileName(file.name);
		setOcrRunning(true);
		try {
			const text = await runOcrOnImage(file);
			if (inputRunIdRef.current !== runId) return;
			setOcrText(text);
			setRawPayload(text);
			setInputStatus(text.trim() ? 'ready' : 'empty');
		} catch (err) {
			if (inputRunIdRef.current !== runId) return;
			console.error('[ImportWizard] OCR failed', err);
			setPickedFileName(null);
			setInputStatus('error');
			setError({
				key:
					err instanceof OcrInitializationError
						? err.requiresReload
							? 'expenses-import.input.errors.ocrNeedsReload'
							: 'expenses-import.input.errors.ocrInit'
						: 'expenses-import.input.errors.ocrFailed',
			});
		} finally {
			if (inputRunIdRef.current === runId) {
				setOcrRunning(false);
			}
		}
	}

	function handleCsvFile(file: File): void {
		const runId = beginInputReplacement();
		if (file.size > MAX_CSV_BYTES) {
			setPickedFileName(null);
			setInputStatus('error');
			setError({ key: 'expenses-import.input.errors.csvTooLarge' });
			return;
		}
		setPickedFileName(file.name);
		void file
			.arrayBuffer()
			.then((buffer) => {
				const text = decodeCsv(buffer);
				if (inputRunIdRef.current !== runId) return;
				setRawPayload(text);
				setInputStatus(text.trim() ? 'ready' : 'empty');
			})
			.catch(() => {
				if (inputRunIdRef.current !== runId) return;
				setPickedFileName(null);
				setInputStatus('error');
				setError({ key: 'expenses-import.input.errors.fileUnreadable' });
			});
	}

	return {
		rawPayload,
		ocrText,
		ocrRunning,
		inputStatus,
		setInputStatus,
		pickedFileName,
		resetInput,
		setManualPayload,
		handleOcrFile,
		handleCsvFile,
	};
}

export type ImportInput = ReturnType<typeof useImportInput>;
