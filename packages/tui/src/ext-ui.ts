import { Container, SelectList, Text, Editor, type TUI, type OverlayHandle, type SelectItem, type Component } from "@earendil-works/pi-tui"
import type { ExtensionUIContext, UINotifyType } from "@fuck/agent"
import type { FuckTheme } from "./theme"

// extension ctx.ui implementation (select/confirm/input/notify/setStatus/setWidget/editor)

export function createUIContext(
  tui: TUI,
  theme: FuckTheme,
  focusEditor: () => void,
): ExtensionUIContext {
  let activeOverlay: OverlayHandle | null = null

  function show(component: Component, width: number, maxHeight: number): OverlayHandle {
    if (activeOverlay) activeOverlay.hide()
    const handle = tui.showOverlay(component, { width, maxHeight })
    activeOverlay = handle
    return handle
  }

  function close(handle: OverlayHandle | null) {
    if (handle) handle.hide()
    if (activeOverlay === handle) activeOverlay = null
    focusEditor()
  }

  return {
    select(title, options) {
      return new Promise((resolve) => {
        const items: SelectItem[] = options.map((o) => ({ value: o, label: o }))
        const list = new SelectList(items, 15, theme.selectList)
        let handle: OverlayHandle | null = null
        list.onSelect = (item) => {
          close(handle)
          resolve(item.value)
        }
        list.onCancel = () => {
          close(handle)
          resolve(undefined)
        }
        const c = new Container()
        c.addChild(new Text(theme.role(title), 1, 1))
        c.addChild(list)
        handle = show(c, 60, 18)
        tui.setFocus(list)
      })
    },

    confirm(title, message) {
      return new Promise((resolve) => {
        const list = new SelectList(
          [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ],
          2,
          theme.selectList,
        )
        let handle: OverlayHandle | null = null
        list.onSelect = (item) => {
          close(handle)
          resolve(item.value === "yes")
        }
        list.onCancel = () => {
          close(handle)
          resolve(false)
        }
        const c = new Container()
        c.addChild(new Text(theme.role(title) + "\n" + theme.statusText(message), 1, 1))
        c.addChild(list)
        handle = show(c, 60, 8)
        tui.setFocus(list)
      })
    },

    input(title, placeholder) {
      return new Promise((resolve) => {
        let handle: OverlayHandle | null = null
        const editor = new Editor(tui, theme.editor, { paddingX: 1 })
        if (placeholder) editor.setText(placeholder)
        editor.onSubmit = (text) => {
          close(handle)
          resolve(text)
        }
        const c = new Container()
        c.addChild(new Text(theme.role(title), 1, 1))
        c.addChild(editor)
        handle = show(c, 60, 5)
        tui.setFocus(editor)
      })
    },

    editor(title, prefill) {
      return new Promise((resolve) => {
        let handle: OverlayHandle | null = null
        const editor = new Editor(tui, theme.editor, { paddingX: 1 })
        if (prefill) editor.setText(prefill)
        editor.onSubmit = (text) => {
          close(handle)
          resolve(text)
        }
        const c = new Container()
        c.addChild(new Text(theme.role(title), 1, 1))
        c.addChild(editor)
        handle = show(c, 70, 15)
        tui.setFocus(editor)
      })
    },

    notify(message: string, _type: UINotifyType = "info") {
      const c = new Container()
      c.addChild(new Text(message, 1, 1))
      // auto-close notification overlay after 2s (non-blocking)
      const handle = show(c, 60, 4)
      setTimeout(() => {
        if (activeOverlay === handle) close(handle)
      }, 2000)
    },

    setStatus() {
      // the status bar is managed by the app layer; extension setStatus is currently a no-op
    },

    setWidget() {
      // widget not implemented yet (editor-top panel, later)
    },
  }
}
