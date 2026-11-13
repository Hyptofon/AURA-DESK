import type { DisplayConfiguration, DisplayInfo } from '@/shared/contracts/channels'

/**
 * Resolve the two explicitly allowed display IDs for P1.3.
 *
 * MVP policy: `both` is available only when exactly two distinct, extended
 * displays are reported. Never silently select the first two of 3+ displays,
 * accept mirrored bounds, or substitute a primary display on failure.
 *
 * This function performs metadata-only validation; it does not grant capture
 * permission or prove that a display maps to a physical desktopCapturer source.
 */
export function selectDualDisplayIds(config: DisplayConfiguration): readonly [string, string] {
    if (
        !config ||
        !Array.isArray(config.displays) ||
        config.displays.length !== 2 ||
        config.count !== 2 ||
        config.isMultiDisplay !== true
    ) {
        throw new Error('Dual-display capture requires exactly two detected displays')
    }

    const [first, second] = config.displays
    const validId = (display: DisplayInfo): boolean =>
        typeof display?.id === 'string' && display.id.trim().length > 0

    if (!validId(first) || !validId(second) || first.id === second.id) {
        throw new Error('Dual-display capture requires two distinct, non-empty display IDs')
    }

    const validBounds = (display: DisplayInfo): boolean => {
        const bounds = display.bounds
        return (
            bounds !== null &&
            typeof bounds === 'object' &&
            Number.isFinite(bounds.x) &&
            Number.isFinite(bounds.y) &&
            Number.isFinite(bounds.width) &&
            Number.isFinite(bounds.height) &&
            bounds.width > 0 &&
            bounds.height > 0
        )
    }

    if (!validBounds(first) || !validBounds(second)) {
        throw new Error('Dual-display capture requires valid bounds for both displays')
    }

    if (
        first.bounds.x === second.bounds.x &&
        first.bounds.y === second.bounds.y &&
        first.bounds.width === second.bounds.width &&
        first.bounds.height === second.bounds.height
    ) {
        throw new Error('Dual-display capture rejects mirrored or ambiguous display bounds')
    }

    const primaryDisplays = config.displays.filter((display) => display.isPrimary === true)
    if (
        primaryDisplays.length !== 1 ||
        typeof config.primaryId !== 'string' ||
        config.primaryId !== primaryDisplays[0].id
    ) {
        throw new Error('Dual-display capture requires one consistent primary display')
    }

    const primary = primaryDisplays[0]
    const secondary = config.displays.find((display) => display.id !== primary.id)
    if (!secondary) {
        throw new Error('Dual-display capture cannot resolve the secondary display')
    }

    return [primary.id, secondary.id]
}
