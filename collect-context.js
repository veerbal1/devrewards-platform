#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Directories to scan
const DIRS_TO_SCAN = [
  'programs/devrewards-platform/src',
  'tests',
];

// File extensions to include
const EXTENSIONS = ['.rs', '.ts', '.js'];

// Output file
const OUTPUT_FILE = 'llm-context.txt';

function getAllFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) {
    console.log(`Warning: Directory ${dirPath} does not exist, skipping...`);
    return arrayOfFiles;
  }

  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);

    if (fs.statSync(filePath).isDirectory()) {
      arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
    } else {
      const ext = path.extname(file);
      if (EXTENSIONS.includes(ext)) {
        arrayOfFiles.push(filePath);
      }
    }
  });

  return arrayOfFiles;
}

function collectCodeFiles() {
  let allFiles = [];

  // Collect files from all specified directories
  DIRS_TO_SCAN.forEach(dir => {
    const files = getAllFiles(dir);
    allFiles = allFiles.concat(files);
  });

  if (allFiles.length === 0) {
    console.log('No code files found!');
    return;
  }

  // Sort files for consistent output
  allFiles.sort();

  let output = '';
  output += '# Code Context for LLM\n';
  output += `# Generated: ${new Date().toISOString()}\n`;
  output += `# Total files: ${allFiles.length}\n`;
  output += '\n' + '='.repeat(80) + '\n\n';

  // Add table of contents
  output += '## Table of Contents\n\n';
  allFiles.forEach((file, index) => {
    output += `${index + 1}. ${file}\n`;
  });
  output += '\n' + '='.repeat(80) + '\n\n';

  // Add file contents
  allFiles.forEach((file) => {
    const relativePath = file;
    const content = fs.readFileSync(file, 'utf8');

    output += `## File: ${relativePath}\n`;
    output += `${'='.repeat(80)}\n\n`;
    output += '```' + path.extname(file).substring(1) + '\n';
    output += content;
    output += '\n```\n\n';
    output += '='.repeat(80) + '\n\n';
  });

  // Write to output file
  fs.writeFileSync(OUTPUT_FILE, output);

  console.log(`✓ Successfully collected ${allFiles.length} files into ${OUTPUT_FILE}`);
  console.log(`✓ Output file size: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2)} KB`);
  console.log('\nFiles included:');
  allFiles.forEach(file => console.log(`  - ${file}`));
}

// Run the script
try {
  collectCodeFiles();
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
