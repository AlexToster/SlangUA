import type { SlangStyle } from '../types/api';
import type { LucideIcon } from 'lucide-react';
import { Smartphone, Lightbulb, Terminal, Fence, Stamp, Mountain } from 'lucide-react';

import genZArt from '../assets/styles/gen-z.webp';
import streetArt from '../assets/styles/street.webp';
import itSlangArt from '../assets/styles/it-slang.webp';
import pofeniArt from '../assets/styles/pofeni.webp';
import kanclerArt from '../assets/styles/kancler.webp';
import galicianArt from '../assets/styles/galician.webp';

// Record<SlangStyle, string> навмисно вичерпний: додавання сьомого стилю
// має ламати typecheck, доки для нього не додано ілюстрацію.
export const STYLE_ART: Record<SlangStyle, string> = {
  GEN_Z: genZArt,
  STREET: streetArt,
  IT_SLANG: itSlangArt,
  POFENI: pofeniArt,
  KANCLER: kanclerArt,
  GALICIAN: galicianArt,
};

// Невеликі логотипчики, що характеризують кожен стиль (зліва від назви).
export const STYLE_ICONS: Record<SlangStyle, LucideIcon> = {
  GEN_Z: Smartphone,      // молодіжний — смартфон
  STREET: Lightbulb,      // вуличний — вуличний ліхтар
  IT_SLANG: Terminal,     // айтішний — термінал
  POFENI: Fence,          // зеківський — грати
  KANCLER: Stamp,         // бюрократичний — печатка
  GALICIAN: Mountain,     // ґвара — силует Карпат
};
