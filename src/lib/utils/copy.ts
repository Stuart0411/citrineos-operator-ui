// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { toast } from 'sonner';

const fallbackCopyText = (value: string): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
};

export const copy = async (
  value: string | null | undefined,
  displayValue = true,
) => {
  if (!value) return;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else if (!fallbackCopyText(value)) {
      throw new Error('Clipboard API unavailable');
    }
  } catch {
    if (!fallbackCopyText(value)) {
      toast.error('Unable to copy to clipboard in this browser context.');
      return;
    }
  }

  toast.message(`Copied${displayValue ? ` ${value}` : ''} to clipboard.`);
};
