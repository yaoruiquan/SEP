/**
 * Z-Index Token Scale
 *
 * Systematic layering to prevent stacking chaos.
 * Use these tokens for all overlays, dropdowns, and floating elements.
 */

export const Z_INDEX = {
  // Base content layers
  base: 0,
  sticky: 10,
  dropdown: 20,

  // Overlay layers (ascending priority)
  drawer: 40,        // Side drawers, sheets
  dialog: 50,        // Modal dialogs (standard)
  popover: 50,       // Popovers, tooltips (same tier as dialog)
  toast: 60,         // Toast notifications

  // Critical system layers
  loading: 70,       // Full-screen loading overlays
  tooltip: 80,       // Critical tooltips that must appear above everything
} as const;

/**
 * Tailwind class map for convenience.
 * Use these in className instead of hardcoding z-* values.
 */
export const Z_CLASS = {
  base: 'z-0',
  sticky: 'z-10',
  dropdown: 'z-20',
  drawer: 'z-40',
  dialog: 'z-50',
  popover: 'z-50',
  toast: 'z-[60]',
  loading: 'z-[70]',
  tooltip: 'z-[80]',
} as const;
