/**
 * Bunprise UI kit — design-system-motion.md §3.
 * Import from '@/ui' (or '../ui'); never import a component file directly.
 */
// the floating glass of the kit (styles/glass.css): with every chunk that uses the kit, never with /i
import '../styles/glass.css';
import '../styles/kit.css';

export { cn } from './cn';
export {
  springs,
  instant,
  fade,
  springCss,
  getMotionMode,
  useMotionMode,
  getMotionAttr,
  useMotionAttr,
  getBunniesShown,
  useBunniesShown,
  useReducedMotionPref,
  useSpring,
  useTapScale,
} from './motion';
export type { SpringName, MotionMode, MotionAttr } from './motion';
export { haptic, setHaptics } from './haptics';
export type { HapticKind, HapticHandler } from './haptics';
export { LayerRootProvider, useLayerRoot } from './layers';

export * from './icons';
export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';
export { Button, ButtonLink, buttonClass } from './Button';
export type { ButtonProps, ButtonLinkProps, ButtonVariant, ButtonSize, ButtonStyleOptions } from './Button';
export { IconButton } from './IconButton';
export type { IconButtonProps, IconButtonVariant } from './IconButton';
export { FieldShell, controlClass, describedBy, fieldIds } from './Field';
export type { FieldShellProps } from './Field';
export { TextField, otpInputClass } from './TextField';
export type { TextFieldProps } from './TextField';
export { OtpField } from './OtpField';
export type { OtpFieldProps } from './OtpField';
export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';
export { TextArea } from './TextArea';
export type { TextAreaProps } from './TextArea';
export { PriceField, formatCents, parseCents, PRICE_MAX_CENTS } from './PriceField';
export type { PriceFieldProps } from './PriceField';
export { Chip, ChipGroup } from './Chip';
export type { ChipProps, ChipGroupProps } from './Chip';
export { Card } from './Card';
export type { CardProps } from './Card';
export { List, ListRow, ListRowContent, listItemClass, listRowClass } from './ListRow';
export type { ListRowProps, ListRowContentProps } from './ListRow';
// Sheet and Confirm are NOT re-exported here either (26.10, bundle budget — like Toast below): the barrel put
// Sheet.tsx (+ its glass, drag and focus code) into the first screens' shared chunk although no first screen opens
// a sheet. Import them directly: `import { Sheet } from '../../ui/Sheet'`, `import { Confirm } from '../../ui/Confirm'`.
// Toast is NOT re-exported here (24.10, bundle budget): a re-export from this barrel puts Toast.tsx into the first
// screens' shared chunks although only the lazy ToastHost renders it (≈ 1 KB gz on /soon). The app shows toasts
// through src/lib/toast.ts + ToastHost (`import { ToastHost } from './ui/ToastHost'`, lazy in routes/__root.tsx);
// the kit's own ToastProvider / useToast / ToastViewport are imported from './Toast' directly.
export { Skeleton, SkeletonList } from './Skeleton';
export type { SkeletonProps, SkeletonListProps } from './Skeleton';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { TopBar } from './TopBar';
export type { TopBarProps, TopBarBack } from './TopBar';
export { Page, LargeTitle, usePageScrolled, usePageUnderBar } from './Page';
export type { PageProps } from './Page';
// Scene (start screen) is imported by file, `import { Scene } from '../ui/Scene'`: it brings its own
// stylesheet (styles/scene.css), which must not ride along with every chunk that uses the barrel.
// The same for AmbientTint (per-occasion tint of the scene): `import { AmbientTint } from '../ui/AmbientTint'`.
export { IconTile } from './IconTile';
export type { IconTileProps, IconTileTone } from './IconTile';
export { DateBadge } from './DateBadge';
export type { DateBadgeProps } from './DateBadge';
export { tileTone } from './tile';
export type { TileTone } from './tile';
export { Banner } from './Banner';
export type { BannerProps, BannerKind } from './Banner';
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';
export { Segmented } from './Segmented';
export type { SegmentedProps, SegmentedOption, SegmentedTone } from './Segmented';
export { Avatar, initials } from './Avatar';
export { AppMark, BrandMark, BrandStamp } from './AppMark';
export type { AvatarProps } from './Avatar';
export { Link, linkClass } from './Link';
export type { LinkProps } from './Link';
export { Divider } from './Divider';
export type { DividerProps } from './Divider';
