import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function ConfirmDialog({
  open,
  title = "Sigurado ka ba?",
  description = "",
  confirmLabel = "Oo, proceed",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel?.()}>
      <AlertDialogContent className="max-w-sm mx-4">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg">{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="text-sm text-stone-500">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={onCancel} className="touch-target">
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={`touch-target ${
              variant === "destructive"
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}