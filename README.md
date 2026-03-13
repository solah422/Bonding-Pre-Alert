# Shipping Manifest AI Scanner

A powerful, React-based web application designed to streamline the auditing of shipping manifests. It helps customs, freight forwarders, and logistics teams quickly identify restricted goods, masked descriptions, and regulated items using Google's Gemini AI.

## Features

- **CSV Manifest Processing**: Upload and parse large shipping manifest CSV files instantly.
- **AI-Powered Scanning**: Integrates with the Google Gemini API to automatically analyze package descriptions. It specifically looks for:
  - Masked descriptions trying to hide regulated items.
  - Supplements and electronics.
  - Vehicle spare parts (cars and motorcycles, e.g., "airblade exhaust cover").
- **Manual Auditing Workflow**: Easily review items, flag them for potential bonding, or mark them as cleared.
- **Smart Batching**: The AI scan processes items in batches to respect API limits and tracks previously scanned items to avoid redundant checks.
- **Export Capabilities**: Export your audited lists (Flagged, Manual Check, Checked) back to CSV format with AI reasons and matched keywords included.
- **Customizable Themes**: Personalize your workspace with built-in themes including Default, Red Lava, and Golden Day.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **CSV Parsing**: PapaParse
- **AI Integration**: `@google/genai` (Gemini 3.1 Flash Preview)

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- A Google Gemini API Key (Get one from [Google AI Studio](https://aistudio.google.com/))

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/shipping-manifest-scanner.git
   cd shipping-manifest-scanner
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:3000` (or the port specified by Vite).

## Usage

1. **Configure API Key & Theme**: Click on the Settings (gear) icon in the app to enter your Gemini API Key and select your preferred UI theme.
2. **Upload Manifest**: Drag and drop your shipping manifest CSV file into the upload area, or click to browse.
   - *Note: The CSV should ideally contain columns like `HAWB`, `PackageDesc`, `ConsigneeName`, and `ConsigneeContactNo`.*
3. **Review & Scan**: 
   - Items will populate in the "Manual Check" tab.
   - Click **AI SCAN** to let Gemini analyze the package descriptions for restricted items.
   - Flagged items will automatically move to the "Flagged" tab with the AI's reasoning.
4. **Manual Audit**: Use the "FLAG" or "Will Not Be Bonded" buttons to manually process items.
5. **Export**: Click the "Export CSV" button on any tab to download the processed data.

## License

This project is licensed under the MIT License.
