/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#F4F7FA',
    tint: '#65E7F5',
    background: '#090B10',
    foreground: '#F4F7FA',
    card: '#11151D',
    cardForeground: '#F4F7FA',
    primary: '#65E7F5',
    primaryForeground: '#081014',
    secondary: '#1A202B',
    secondaryForeground: '#DCE5EA',
    muted: '#161B24',
    mutedForeground: '#8996A3',
    accent: '#FF806D',
    accentForeground: '#180C0A',
    destructive: '#FF6B6B',
    destructiveForeground: '#FFFFFF',
    border: '#27313D',
    input: '#1D2530',
    success: '#8CE2A8',
    grid: '#1A222C',
  },
  dark: {
    text: '#F4F7FA',
    tint: '#65E7F5',
    background: '#090B10',
    foreground: '#F4F7FA',
    card: '#11151D',
    cardForeground: '#F4F7FA',
    primary: '#65E7F5',
    primaryForeground: '#081014',
    secondary: '#1A202B',
    secondaryForeground: '#DCE5EA',
    muted: '#161B24',
    mutedForeground: '#8996A3',
    accent: '#FF806D',
    accentForeground: '#180C0A',
    destructive: '#FF6B6B',
    destructiveForeground: '#FFFFFF',
    border: '#27313D',
    input: '#1D2530',
    success: '#8CE2A8',
    grid: '#1A222C',
  },
  radius: 18,
};

export default colors;
