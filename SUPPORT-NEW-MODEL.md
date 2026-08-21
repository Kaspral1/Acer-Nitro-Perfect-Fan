# How to Help Add Support for Your Model (Linux)

If your laptop (e.g., newer Acer Nitro models with locked EC fan reads/writes) is not yet fully supported by **Acer Nitro Perfect Fan**, you can help us figure out how the factory cooling system is managed.

All the necessary information for this is hidden in your motherboard's firmware (ACPI tables). Newer models have direct fan speed writing blocked, and to bypass this, they use ACPI-WMI methods. We will decode them by analyzing the firmware files from your laptop.

> [!NOTE]
> **Is this safe, and am I sharing private data?**
> **Yes, it is completely safe!** The files generated in the steps below (ACPI memory dumps) are just code provided by the hardware manufacturer (Acer). They do NOT contain any personal files, passwords, usernames, or even unique hardware serial numbers. Typically, they only contain hardware definitions for system devices, ports, and cooling logic. You can safely and publicly upload them to a GitHub Issue.

---

## Step 1: Extracting ACPI Tables

1. Install the ACPI tool packages for your specific system:
   * **Ubuntu / Debian / Linux Mint:** `sudo apt update && sudo apt install -y acpica-tools`
   * **Arch Linux / Manjaro:** `sudo pacman -S acpica`
   * **Fedora:** `sudo dnf install acpica-tools`

2. Copy the single block of commands below and paste it into your terminal all at once. It will automatically create a folder, extract the files, decode them, and compress them for you:

   ```bash
   mkdir -p ~/acpi_dump && cd ~/acpi_dump && sudo acpidump -b && iasl -d *.dat && zip -r ~/acpi_dump_my_model.zip ~/acpi_dump && echo "DONE! The file acpi_dump_my_model.zip is ready in your home directory."
   ```

3. That's it! You will find the ready `acpi_dump_my_model.zip` archive in your home directory (`/home/your_username/`).

---

## Step 2: Sending the files to us

Once you have the compressed archive from Step 1:

1. Go to our project page on **GitHub** and navigate to the **Issues** tab.
2. Click the **New Issue** button.
3. For the title, type something like: `ACPI Dump for model [Your exact model, e.g., ANV15-51]`.
4. Drag and drop the `acpi_dump_my_model.zip` file from your home directory (`/home/your_username/`) into the text box to attach it.

With this single `.zip` archive, we will be able to figure out the ACPI methods assigned to the fan speeds on your hardware and design a patch for the program!
