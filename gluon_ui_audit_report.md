# Gluon Hands-On UI/UX Audit Report (1080p Desktop)

**Date:** March 17, 2026
**Focus:** Hands-on audit of the UI (apart from Surface and AI), concentrating on visual design, UX, and usability from a desktop environment (1920x1080).

## 1. Global UI & First Impressions
At a standard desktop resolution, the UI breathes much better than on narrow viewports. 
*   **BPM and Transport:** The BPM display is clearly visible in the top center bar, and it successfully accepts numeric input interactions natively. The Play/Stop/Loop/Record transport controls are well-grouped.
*   **Sidebar Navigation:** Adding tracks works reliably. A minor UX friction point is that adding a new track automatically shifts the viewport focus to that exact track, which can be jarring.
*   **Aesthetics:** The dark, high-contrast theme (`zinc-900`/`zinc-950`) maintains decent legibility. 

## 2. Patch View
The drag-to-connect node interface is fundamentally functional but remains the most "building site" aspect of the current design:
*   **Severe Legibility Bug (Overlapping Text):** Even at 1080p, the parameter labels at the bottom of nodes (like the Rings 'Modal Resonator' node) are **completely crammed and overlapping**. Text like `structure`, `brightness`, `damping`, and `position` render as an illegible mass (e.g. `structbrightnespositione-tonanpolyo-bhny`).
*   **Truncated Node Titles:** Long module names remain awkwardly truncated (e.g. `Mutable Instruments Ri...`).
*   **UX Safety Hazard (Delete Key):** When selecting a node and pressing `Delete`, if focus is slightly off, it frequently deletes the entire parent Track instead of just the node. (I had to use Undo to recover from this twice).

![Patch View Legibility Issue](/Users/tobykershaw/.gemini/antigravity/brain/9eb4773d-a17f-4f9f-af14-829c97bffc57/.system_generated/click_feedback/click_feedback_1773776612384.png)
*Caption: The Patch view showing functional cabliling but severely crammed parameter texts at the bottom of the nodes.*

## 3. Rack View
The 1080p Rack view succeeds in achieving the "Euro-rack" mental model much better than narrow layouts:
*   **Horizontal Layout:** It successfully displays the module chain side-by-side (e.g., Plaits next to Rings).
*   **Parameter Units:** Knobs display normalized values (0–100/1.0), but to achieve a "mature" implementation, it would be beneficial to display the specific musical unit where applicable (Hz, MIDI note, ms).
*   **Truncated Labels:** Minor cosmetic issue where labels like "FM Amount" or "Timbre Mod" get truncated to `Timbre M...` despite ample screen width.

![Rack View 1080p](/Users/tobykershaw/.gemini/antigravity/brain/9eb4773d-a17f-4f9f-af14-829c97bffc57/.system_generated/click_feedback/click_feedback_1773776403858.png)
*Caption: The Rack view at 1080p correctly stacks modules horizontally, a huge improvement over the narrow layout.*

## 4. Tracker View
While basic sequencing works, the Tracker is missing critical paradigm features:
*   **Missing Keyboard Mapping:** Standard tracker QWERTY-to-piano keyboard mapping (e.g. pressing `Z` to enter a `C-3`) is completely absent. Users currently have to type "C-3" as raw text, which is an enormous workflow killer.
*   **Missing Selection Feedback:** Multi-row and multi-column selection is functional for batch commands (like Transpose), but there is absolutely no visual highlight to indicate what region is currently selected. 
*   **Input Validation:** The grid cells are untyped/unvalidated string inputs. They currently accept raw paragraph text, which breaks the CSS grid formatting if abused.

![Tracker View Missing Highlight](/Users/tobykershaw/.gemini/antigravity/brain/9eb4773d-a17f-4f9f-af14-829c97bffc57/.system_generated/click_feedback/click_feedback_1773776474397.png)
*Caption: The Tracker allows entry, but has no visual highlights when dragging across multiple notes.*

## 5. Workflow Test (Making a Simple Song)
Building a multi-voice patch and sequence is possible. However, the feeling of "playing" the instrument is heavily diminished because of the lack of audible note previews on keypress in the Tracker, and the total lack of QWERTY piano mapping.

## Conclusion
The application fundamentally works at a structural level across the major views. The primary issues dragging down the "mature UX" feel are the missing core Tracker conveniences (keyboard mapping, visual highlights, previews) and the severe SVG/CSS legibility issues on node labels in the Patch canvas.

*New issues have been proposed for the repository focusing on these desktop findings.*
