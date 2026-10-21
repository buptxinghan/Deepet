// Read-only macOS snapshot. No preferences, fan controls, or privileged helpers.
import Foundation
import Darwin
import IOKit

func cpuTicks() -> [UInt64]? {
    var info = host_cpu_load_info()
    var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count)
        }
    }
    guard result == KERN_SUCCESS else { return nil }
    return withUnsafeBytes(of: info.cpu_ticks) { Array($0.bindMemory(to: UInt32.self)).map(UInt64.init) }
}

func memoryUsage() -> [String: Any] {
    var info = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count)
        }
    }
    let total = Double(ProcessInfo.processInfo.physicalMemory)
    guard result == KERN_SUCCESS else { return ["ram_used_pct": NSNull(), "ram_total_bytes": total] }
    // Same category formula used by Stats RAM UsageReader: app + wired + compressed.
    let page = Double(vm_kernel_page_size)
    let appPages = max(0.0, Double(info.active_count) + Double(info.inactive_count) + Double(info.speculative_count) - Double(info.purgeable_count) - Double(info.external_page_count))
    let used = min(total, (appPages + Double(info.wire_count) + Double(info.compressor_page_count)) * page)
    return ["ram_used_pct": used / total * 100, "ram_used_bytes": used, "ram_total_bytes": total]
}

func gpuUsage() -> Double? {
    var iterator: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &iterator) == KERN_SUCCESS else { return nil }
    defer { IOObjectRelease(iterator) }
    while true {
        let service = IOIteratorNext(iterator)
        if service == 0 { break }
        defer { IOObjectRelease(service) }
        guard let properties = IORegistryEntryCreateCFProperty(service, "PerformanceStatistics" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? [String: Any] else { continue }
        if let value = properties["Device Utilization %"] as? NSNumber {
            let number = value.doubleValue
            if number >= 0 && number <= 100 { return number }
        }
    }
    return nil
}

func diskUsage() -> [String: Any] {
    let url = URL(fileURLWithPath: "/System/Volumes/Data")
    guard let data = try? url.resourceValues(forKeys: [.volumeTotalCapacityKey, .volumeAvailableCapacityKey]),
          let total = data.volumeTotalCapacity, let free = data.volumeAvailableCapacity, total > 0 else {
        return ["disk_used_pct": NSNull(), "disk_free_bytes": NSNull()]
    }
    return ["disk_used_pct": (1 - Double(free) / Double(total)) * 100,
            "disk_free_bytes": free, "disk_total_bytes": total,
            "disk_label": "Mac 系统盘", "disk_semantics": "APFS volume capacity used; not SSD wear or I/O load"]
}

func userIdleSeconds() -> Double? {
    let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOHIDSystem"))
    guard service != 0 else { return nil }
    defer { IOObjectRelease(service) }
    guard let number = IORegistryEntryCreateCFProperty(service, "HIDIdleTime" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? NSNumber else { return nil }
    return number.doubleValue / 1_000_000_000
}

let ticks = cpuTicks()
let thermalNames = ["nominal", "fair", "serious", "critical"]
let thermalIndex = ProcessInfo.processInfo.thermalState.rawValue
var snapshot: [String: Any] = [
    "cpu_pct": NSNull(), "cpu_ticks": ticks as Any? ?? NSNull(), "gpu_pct": gpuUsage() as Any? ?? NSNull(),
    "thermal_state": thermalNames.indices.contains(thermalIndex) ? thermalNames[thermalIndex] : "unknown",
    "user_idle_seconds": userIdleSeconds() as Any? ?? NSNull(),
    "available": true, "sampled_at": Date().timeIntervalSince1970 * 1000,
    "source": "macOS Mach + IORegistry + Foundation"
]
snapshot.merge(memoryUsage()) { _, value in value }
snapshot.merge(diskUsage()) { _, value in value }
let bytes = try JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys])
FileHandle.standardOutput.write(bytes)
FileHandle.standardOutput.write(Data([10]))
