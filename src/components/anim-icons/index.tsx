/* Drop-in animated icons for the site's shell (nav, menus, home, shop, rewards, profile…).
   Same names and props as lucide-react, so a file only swaps its import:
       import { Bell, Gift } from "../components/anim-icons";
   Extra props:  loop  (true or seconds) replays every few seconds while on screen
                 appear={false}  skips the draw-in when the icon first shows
                 play={value}    replays whenever `value` changes
   Lite mode and "reduce motion" get the plain lucide-react icon, and the animation code
   (./engine, with Motion) is never downloaded there. Icons inside game screens stay plain
   lucide-react on purpose, so the games keep their frame rate. */
import { lazy, Suspense, type ComponentType } from "react";
import type { LucideIcon as StaticIcon, LucideProps } from "lucide-react";
import { usePerf } from "../../lib/perf";
import {
  ArrowRight as S_ArrowRight,
  ArrowUpDown as S_ArrowUpDown,
  Atom as S_Atom,
  Bell as S_Bell,
  BellOff as S_BellOff,
  Bomb as S_Bomb,
  Bot as S_Bot,
  Brain as S_Brain,
  Building2 as S_Building2,
  Calculator as S_Calculator,
  CalendarCheck as S_CalendarCheck,
  CalendarClock as S_CalendarClock,
  Car as S_Car,
  Check as S_Check,
  ChevronDown as S_ChevronDown,
  ChevronLeft as S_ChevronLeft,
  ChevronRight as S_ChevronRight,
  CircleDot as S_CircleDot,
  Coins as S_Coins,
  Columns3 as S_Columns3,
  Copy as S_Copy,
  Crown as S_Crown,
  Dices as S_Dices,
  Disc as S_Disc,
  DoorOpen as S_DoorOpen,
  Download as S_Download,
  ExternalLink as S_ExternalLink,
  Eye as S_Eye,
  EyeOff as S_EyeOff,
  Flame as S_Flame,
  GalleryHorizontalEnd as S_GalleryHorizontalEnd,
  Gamepad2 as S_Gamepad2,
  Gauge as S_Gauge,
  Gift as S_Gift,
  Globe as S_Globe,
  GraduationCap as S_GraduationCap,
  Grid2x2 as S_Grid2x2,
  Hammer as S_Hammer,
  HandCoins as S_HandCoins,
  Hash as S_Hash,
  Heart as S_Heart,
  HelpCircle as S_HelpCircle,
  History as S_History,
  House as S_House,
  Info as S_Info,
  Joystick as S_Joystick,
  KeyRound as S_KeyRound,
  Keyboard as S_Keyboard,
  Layers as S_Layers,
  LayoutGrid as S_LayoutGrid,
  Lightbulb as S_Lightbulb,
  LoaderCircle as S_LoaderCircle,
  Lock as S_Lock,
  LogIn as S_LogIn,
  LogOut as S_LogOut,
  Mail as S_Mail,
  Medal as S_Medal,
  Megaphone as S_Megaphone,
  Menu as S_Menu,
  MessageCircle as S_MessageCircle,
  MessageCircleOff as S_MessageCircleOff,
  MessageSquare as S_MessageSquare,
  Minimize2 as S_Minimize2,
  Moon as S_Moon,
  Mountain as S_Mountain,
  MoveUpRight as S_MoveUpRight,
  Music as S_Music,
  Music4 as S_Music4,
  Orbit as S_Orbit,
  Palette as S_Palette,
  PartyPopper as S_PartyPopper,
  Pencil as S_Pencil,
  Play as S_Play,
  Plus as S_Plus,
  Puzzle as S_Puzzle,
  RotateCcw as S_RotateCcw,
  Search as S_Search,
  Settings as S_Settings,
  Settings2 as S_Settings2,
  Share2 as S_Share2,
  Shield as S_Shield,
  ShieldBan as S_ShieldBan,
  ShieldCheck as S_ShieldCheck,
  ShoppingBag as S_ShoppingBag,
  Shuffle as S_Shuffle,
  Smartphone as S_Smartphone,
  Spade as S_Spade,
  Sparkles as S_Sparkles,
  Sun as S_Sun,
  Swords as S_Swords,
  Target as S_Target,
  TrainFront as S_TrainFront,
  Trophy as S_Trophy,
  Tv as S_Tv,
  Type as S_Type,
  UserPlus as S_UserPlus,
  UserRound as S_UserRound,
  Users as S_Users,
  Wallet as S_Wallet,
  Wand2 as S_Wand2,
  WifiOff as S_WifiOff,
  Wind as S_Wind,
  Worm as S_Worm,
  X as S_X,
  Zap as S_Zap,
} from "lucide-react";

export type AnimIconProps = LucideProps & {
  /** replay every few seconds while visible (true = the icon's own pace, or seconds) */
  loop?: boolean | number;
  /** draw in when first on screen (default true) */
  appear?: boolean;
  /** replays whenever this value changes */
  play?: unknown;
};
/** what a map of icons (category icons, poster icons…) should be typed as */
export type LucideIcon = ComponentType<AnimIconProps>;

const Engine = lazy(() => import("./engine"));

let reduced = false;
try {
  const q = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduced = q.matches;
  q.addEventListener("change", (e) => (reduced = e.matches));
} catch {
  /* old browser: animate */
}

/** true when this device should get still icons */
export function useStillIcons() {
  return usePerf().lite || reduced;
}

function make(name: string, Still: StaticIcon): LucideIcon {
  function Icon({ loop, appear, play, ...props }: AnimIconProps) {
    const still = useStillIcons();
    if (still) return <Still {...props} />;
    return (
      <Suspense fallback={<Still {...props} />}>
        <Engine name={name} loop={loop} appear={appear} play={play} {...props} />
      </Suspense>
    );
  }
  Icon.displayName = `Anim${name}`;
  return Icon;
}

export const ArrowRight = make("ArrowRight", S_ArrowRight);
export const ArrowUpDown = make("ArrowUpDown", S_ArrowUpDown);
export const Atom = make("Atom", S_Atom);
export const Bell = make("Bell", S_Bell);
export const BellOff = make("BellOff", S_BellOff);
export const Bomb = make("Bomb", S_Bomb);
export const Bot = make("Bot", S_Bot);
export const Brain = make("Brain", S_Brain);
export const Building2 = make("Building2", S_Building2);
export const Calculator = make("Calculator", S_Calculator);
export const CalendarCheck = make("CalendarCheck", S_CalendarCheck);
export const CalendarClock = make("CalendarClock", S_CalendarClock);
export const Car = make("Car", S_Car);
export const Check = make("Check", S_Check);
export const ChevronDown = make("ChevronDown", S_ChevronDown);
export const ChevronLeft = make("ChevronLeft", S_ChevronLeft);
export const ChevronRight = make("ChevronRight", S_ChevronRight);
export const CircleDot = make("CircleDot", S_CircleDot);
export const Coins = make("Coins", S_Coins);
export const Columns3 = make("Columns3", S_Columns3);
export const Copy = make("Copy", S_Copy);
export const Crown = make("Crown", S_Crown);
export const Dices = make("Dices", S_Dices);
export const Disc = make("Disc", S_Disc);
export const DoorOpen = make("DoorOpen", S_DoorOpen);
export const Download = make("Download", S_Download);
export const ExternalLink = make("ExternalLink", S_ExternalLink);
export const Eye = make("Eye", S_Eye);
export const EyeOff = make("EyeOff", S_EyeOff);
export const Flame = make("Flame", S_Flame);
export const GalleryHorizontalEnd = make("GalleryHorizontalEnd", S_GalleryHorizontalEnd);
export const Gamepad2 = make("Gamepad2", S_Gamepad2);
export const Gauge = make("Gauge", S_Gauge);
export const Gift = make("Gift", S_Gift);
export const Globe = make("Globe", S_Globe);
export const GraduationCap = make("GraduationCap", S_GraduationCap);
export const Grid2x2 = make("Grid2x2", S_Grid2x2);
export const Hammer = make("Hammer", S_Hammer);
export const HandCoins = make("HandCoins", S_HandCoins);
export const Hash = make("Hash", S_Hash);
export const Heart = make("Heart", S_Heart);
export const HelpCircle = make("HelpCircle", S_HelpCircle);
export const History = make("History", S_History);
export const House = make("House", S_House);
export const Info = make("Info", S_Info);
export const Joystick = make("Joystick", S_Joystick);
export const KeyRound = make("KeyRound", S_KeyRound);
export const Keyboard = make("Keyboard", S_Keyboard);
export const Layers = make("Layers", S_Layers);
export const LayoutGrid = make("LayoutGrid", S_LayoutGrid);
export const Lightbulb = make("Lightbulb", S_Lightbulb);
export const LoaderCircle = make("LoaderCircle", S_LoaderCircle);
export const Lock = make("Lock", S_Lock);
export const LogIn = make("LogIn", S_LogIn);
export const LogOut = make("LogOut", S_LogOut);
export const Mail = make("Mail", S_Mail);
export const Medal = make("Medal", S_Medal);
export const Megaphone = make("Megaphone", S_Megaphone);
export const Menu = make("Menu", S_Menu);
export const MessageCircle = make("MessageCircle", S_MessageCircle);
export const MessageCircleOff = make("MessageCircleOff", S_MessageCircleOff);
export const MessageSquare = make("MessageSquare", S_MessageSquare);
export const Minimize2 = make("Minimize2", S_Minimize2);
export const Moon = make("Moon", S_Moon);
export const Mountain = make("Mountain", S_Mountain);
export const MoveUpRight = make("MoveUpRight", S_MoveUpRight);
export const Music = make("Music", S_Music);
export const Music4 = make("Music4", S_Music4);
export const Orbit = make("Orbit", S_Orbit);
export const Palette = make("Palette", S_Palette);
export const PartyPopper = make("PartyPopper", S_PartyPopper);
export const Pencil = make("Pencil", S_Pencil);
export const Play = make("Play", S_Play);
export const Plus = make("Plus", S_Plus);
export const Puzzle = make("Puzzle", S_Puzzle);
export const RotateCcw = make("RotateCcw", S_RotateCcw);
export const Search = make("Search", S_Search);
export const Settings = make("Settings", S_Settings);
export const Settings2 = make("Settings2", S_Settings2);
export const Share2 = make("Share2", S_Share2);
export const Shield = make("Shield", S_Shield);
export const ShieldBan = make("ShieldBan", S_ShieldBan);
export const ShieldCheck = make("ShieldCheck", S_ShieldCheck);
export const ShoppingBag = make("ShoppingBag", S_ShoppingBag);
export const Shuffle = make("Shuffle", S_Shuffle);
export const Smartphone = make("Smartphone", S_Smartphone);
export const Spade = make("Spade", S_Spade);
export const Sparkles = make("Sparkles", S_Sparkles);
export const Sun = make("Sun", S_Sun);
export const Swords = make("Swords", S_Swords);
export const Target = make("Target", S_Target);
export const TrainFront = make("TrainFront", S_TrainFront);
export const Trophy = make("Trophy", S_Trophy);
export const Tv = make("Tv", S_Tv);
export const Type = make("Type", S_Type);
export const UserPlus = make("UserPlus", S_UserPlus);
export const UserRound = make("UserRound", S_UserRound);
export const Users = make("Users", S_Users);
export const Wallet = make("Wallet", S_Wallet);
export const Wand2 = make("Wand2", S_Wand2);
export const WifiOff = make("WifiOff", S_WifiOff);
export const Wind = make("Wind", S_Wind);
export const Worm = make("Worm", S_Worm);
export const X = make("X", S_X);
export const Zap = make("Zap", S_Zap);
