import React, { createContext, useContext, useState, useEffect } from "react";

// Default hotkeys for the app
export const DEFAULT_HOTKEYS = {
  SEARCH_COMMANDS: "ctrl+p",
  TOGGLE_RULER: "r",
  TOGGLE_SIDEBAR: "b",
  TOGGLE_ARCHITECTURE: "alt+a",
  ZOOM_IN: "=",
  ZOOM_OUT: "-",
  FIT_VIEW: "0",
  UNDO: "ctrl+z",
  REDO: "ctrl+shift+z",
  DELETE_SELECTED: "delete",
  TOGGLE_LIGHT_MODE: "ctrl+l",
};

export type HotkeyAction = keyof typeof DEFAULT_HOTKEYS;

interface HotkeyContextType {
  hotkeys: Record<HotkeyAction, string>;
  updateHotkey: (action: HotkeyAction, keyCombo: string) => void;
  isCustomizing: boolean;
  setIsCustomizing: (val: boolean) => void;
}

const HotkeyContext = createContext<HotkeyContextType | undefined>(undefined);

export function HotkeyProvider({ children }: { children: React.ReactNode }) {
  const [hotkeys, setHotkeys] = useState<Record<HotkeyAction, string>>(() => {
    const saved = localStorage.getItem("referenceflow_hotkeys");
    return saved ? JSON.parse(saved) : DEFAULT_HOTKEYS;
  });
  
  const [isCustomizing, setIsCustomizing] = useState(false);

  useEffect(() => {
    localStorage.setItem("referenceflow_hotkeys", JSON.stringify(hotkeys));
  }, [hotkeys]);

  const updateHotkey = (action: HotkeyAction, keyCombo: string) => {
    setHotkeys(prev => ({ ...prev, [action]: keyCombo.toLowerCase() }));
  };

  return (
    <HotkeyContext.Provider value={{ hotkeys, updateHotkey, isCustomizing, setIsCustomizing }}>
      {children}
    </HotkeyContext.Provider>
  );
}

export function useHotkeys() {
  const context = useContext(HotkeyContext);
  if (!context) {
    throw new Error("useHotkeys must be used within HotkeyProvider");
  }
  return context;
}
