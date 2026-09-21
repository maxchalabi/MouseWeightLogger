import { mouseColor } from "../lib/colors";
import { photoUrl } from "../lib/photos";

type Props = {
  name: string;
  id: string;
  color?: string | null;
  photoPath?: string | null;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
};

const SIZES = {
  sm: "h-9 w-9 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-16 w-16 text-lg",
};

export function MouseAvatar({ name, id, color, photoPath, size = "md", muted = false }: Props) {
  const src = photoUrl(photoPath);
  const tone = mouseColor(id, color);
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ring-1 ring-white/10 ${SIZES[size]} ${
        muted ? "opacity-70 grayscale-[35%]" : ""
      }`}
      style={{ background: `${tone}22` }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-medium"
          style={{ color: tone }}
        >
          {initial}
        </div>
      )}
    </div>
  );
}
