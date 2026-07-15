import { useEffect } from "react";
import { useHotkeys, HotkeyAction } from "../context/HotkeyContext";

export function useHotkeyAction(action: HotkeyAction, callback: (e: KeyboardEvent) => void) {
  const { hotkeys } = useHotkeys();
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return;
      }
      
      const keyCombo = hotkeys[action];
      if (!keyCombo) return;
      
      const parts = keyCombo.split("+");
      const requiresCtrl = parts.includes("ctrl");
      const requiresShift = parts.includes("shift");
      const requiresAlt = parts.includes("alt");
      const key = parts[parts.length - 1];
      
      const isCtrlMatched = requiresCtrl === (e.ctrlKey || e.metaKey);
      const isShiftMatched = requiresShift === e.shiftKey;
      const isAltMatched = requiresAlt === e.altKey;
      const isKeyMatched = e.key.toLowerCase() === key || (e.code.toLowerCase().replace("key", "") === key) || (key === "delete" && (e.key === "Delete" || e.key === "Backspace"));
      
      if (isCtrlMatched && isShiftMatched && isAltMatched && isKeyMatched) {
        e.preventDefault();
        callback(e);
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hotkeys, action, callback]);
}
