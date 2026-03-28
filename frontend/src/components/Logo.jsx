import { cn } from "@/lib/utils";

export default function Logo({ className }) {
  return (
    <svg 
      viewBox="0 0 32 32" 
      height="100%"
      width="100%"
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 block", className)}
    >
      {/* Background container with an elegant glowing border */}
      <rect x="2" y="2" width="28" height="28" rx="8" fill="#f59e0b" fillOpacity="0.12" />
      <rect x="2" y="2" width="28" height="28" rx="8" stroke="#f59e0b" strokeWidth="1.5" strokeOpacity="0.5" />
      
      {/* Two upward trend bars representing data/analytics */}
      <rect x="5" y="18" width="5" height="10" rx="1.5" fill="#f59e0b" fillOpacity="0.8" />
      <rect x="13" y="12" width="5" height="16" rx="1.5" fill="#f59e0b" />
      
      {/* The 'Spark' star that completes the upward trend */}
      <path 
        d="M22 4 L23.5 8.5 L28 10 L23.5 11.5 L22 16 L20.5 11.5 L16 10 L20.5 8.5 Z" 
        fill="#fbbf24" 
      />
    </svg>
  );
}
