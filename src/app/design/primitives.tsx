"use client";

import { useState } from "react";
import { Check, ChevronDown, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * THE RADIX PRIMITIVES, ON THE PAGE THAT REVIEWS THEM.
 *
 * `/design` is a server component and every one of these is a client one, so
 * they arrive through a wrapper exactly as the builder's toolbar and config
 * panel already do. Rendering the REAL components rather than a mock-up is the
 * point: this page is the only place the kit can be seen without a session, and
 * a specimen that is a copy of a component drifts from it.
 *
 * What to look at here is behaviour as much as styling — every one of these
 * replaces something this app previously hand-rolled. The menu and the popover
 * close on Escape in the right order when nested; the tabs answer arrow keys,
 * which none of the app's three tab implementations do; the dialog traps focus
 * and gives it back; the tooltip appears for keyboard users at all.
 */
export function PrimitiveSpecimens() {
  const [checked, setChecked] = useState(true);

  return (
    <div className="flex flex-wrap items-start gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            Menu <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Chart</DropdownMenuLabel>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
          <DropdownMenuItem>Chart settings</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <Trash2 /> Remove chart
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary">Popover</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          <p className="text-sm font-semibold text-foreground">Anchored, and portalled</p>
          <p className="mt-1 text-xs text-muted-foreground">
            It escapes every scroll container it is declared in, which is the whole reason the hand-rolled one grew a
            fixed-positioning mode.
          </p>
        </PopoverContent>
      </Popover>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Options">
            <MoreHorizontal />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reachable by keyboard, unlike a title attribute</TooltipContent>
      </Tooltip>

      <Select defaultValue="today">
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="7d">Last 7 days</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
        </SelectContent>
      </Select>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this step?</DialogTitle>
            <DialogDescription>
              Focus is trapped here and handed back to the trigger on close — by the primitive, not by a
              re-query-per-keypress loop.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button variant="destructive">Delete</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>

      <Separator orientation="vertical" className="h-9" />

      <label className="inline-flex h-9 items-center gap-2">
        <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} id="kit-check" />
        <Label htmlFor="kit-check">Show the trend</Label>
      </label>

      <Tabs defaultValue="data" className="w-full">
        <TabsList>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="style">Style</TabsTrigger>
        </TabsList>
        <TabsContent value="data" className="pt-2 text-sm text-muted-foreground">
          Arrow keys move between these. The app&rsquo;s three existing tab strips do not.
        </TabsContent>
        <TabsContent value="style" className="pt-2 text-sm text-muted-foreground">
          <Check className="mr-1 inline size-4 text-success-ink" />
          And the panel follows the selection.
        </TabsContent>
      </Tabs>
    </div>
  );
}
