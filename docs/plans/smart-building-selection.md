# Kế hoạch triển khai API lựa chọn tòa nhà

Trạng thái: đã chốt yêu cầu lựa chọn với người dùng; kế hoạch sẵn sàng triển khai. Chưa triển khai API.

## Mục tiêu và quyết định đã thống nhất

Ứng dụng gửi các đỉnh theo thứ tự của một vùng kín trên bản đồ. Server trả về từng tòa nhà phù hợp cùng đường bao đầy đủ để ứng dụng tự nối và dựng khung hiển thị. Kết quả hợp lệ có thể không chứa tòa nhà nào.

Tiêu chí lựa chọn là tỷ lệ phủ tòa nhà:

`coverageRatio = area(intersection(selection, building)) / area(building)`

Mẫu số là diện tích tòa nhà, không phải diện tích vùng chọn hoặc diện tích hợp của hai hình. Vì vậy, một nhà nhỏ nằm hoàn toàn trong vùng chọn đạt tỷ lệ 1, kể cả khi vùng chọn bao gồm nhiều nhà khác. Tối đa hóa diện tích giao tuyệt đối không phải mục tiêu của API.

Thuật ngữ được định nghĩa trong [CONTEXT.md](../../CONTEXT.md).

## Quy tắc lựa chọn đã chốt

1. Chọn mọi tòa nhà có `coverageRatio >= 0.5`. Đúng 50% được chọn; dưới 50% không được chọn. Đây là ngưỡng cố định của bản đầu, không thêm tham số tùy chỉnh vào request.
2. Khi không có nhà đạt ngưỡng, trả HTTP 200 với `places: []`. Không bắt nhà gần nhất và không mở rộng vùng chọn. Khoảng cách không tham gia điều kiện chọn hoặc xếp hạng.
3. Ngưỡng 50% là quyết định sản phẩm đã thống nhất; cần thử trên nét vẽ thực tế để đánh giá trải nghiệm, không xem đây là ngưỡng tối ưu đã được chứng minh.

## Cơ sở từ repository

- `server/types.ts` có `OSMPlace`, `Polygon`, `MultiPolygon` và tọa độ GeoJSON `[longitude, latitude]`.
- `src/db/schema.ts` lưu đường bao trong JSONB và bbox trong các cột riêng.
- `src/db/osmPlaces.ts:getPlacesByBbox` lọc bbox trước khi xử lý hình học trong TypeScript. Hàm hiện giới hạn tối đa 10.000 kết quả và chưa lọc riêng `placeType`.
- `server.ts` có Express routes và envelope `{ success, data }`. Lookup hiện nhận một điểm, không giải quyết giao diện tích của hai polygon.
- `scripts/init_local_db.sql` chưa cấu hình PostGIS. Không giả định extension đã có trên môi trường triển khai.
- `src/components/MapView.tsx` đã có cách vẽ geometry tòa nhà. Phần nhận nét vẽ, gọi API và nối khung thuộc công việc ứng dụng, ngoài phạm vi thêm API này.
- Chưa có test script trong `package.json`; `npm run lint` kiểm tra TypeScript, `npm run build` kiểm tra build.

## Contract đề xuất

Thêm `POST /api/buildings/select`. Giữ lookup hiện tại nguyên hành vi.

Request:

```json
{
  "coordinates": [
    [106.7000, 10.7700],
    [106.7010, 10.7700],
    [106.7010, 10.7710],
    [106.7000, 10.7710]
  ]
}
```

Server chấp nhận đường bao đã đóng hoặc tự nối điểm cuối với điểm đầu. Bản đầu nhận một đường bao ngoài, không nhận nhiều vùng hoặc lỗ trong vùng chọn. Geometry tòa nhà vẫn phải hỗ trợ lỗ và MultiPolygon.

Response thành công đề xuất là `{ success: true, data: { places: [...] } }`. Mỗi phần tử chứa các trường `OSMPlace` hiện có và `coverageRatio` trong khoảng 0 đến 1. Trả geometry nguyên bản của tòa nhà, không trả phần giao thay cho đường bao. Không có kết quả trả HTTP 200 với `places: []`.

Sắp xếp theo `coverageRatio` giảm dần, tiếp theo diện tích giao giảm dần, cuối cùng `id` tăng dần để kết quả ổn định. Đây là thứ tự hiển thị; mọi nhà đạt điều kiện đều được trả về trong giới hạn request hợp lệ.

## Thiết kế triển khai

### 1. Kiểm tra và chuẩn hóa vùng chọn

Tạo module xử lý lựa chọn tại `server/buildingSelection.ts`, với hàm thuần kiểm tra input và hàm tính kết quả từ danh sách ứng viên. Route chịu trách nhiệm HTTP, repository chịu trách nhiệm truy vấn dữ liệu.

Kiểm tra body, cặp số hữu hạn, giới hạn kinh/vĩ độ, ít nhất ba đỉnh phân biệt, diện tích dương và đường bao không tự cắt. Loại điểm liên tiếp trùng nhau trước khi đóng vòng. Không ép chuỗi thành số và không tự biến vùng lỗi thành convex hull vì làm thay đổi ý định lựa chọn.

Đặt giới hạn hữu hạn cho số đỉnh, diện tích/bbox vùng chọn và số ứng viên. Chốt giá trị sau khi đo trên dữ liệu đại diện. Vùng vượt giới hạn bị từ chối rõ ràng, không âm thầm trả kết quả thiếu. Không hỗ trợ vùng vượt kinh tuyến đổi ngày trong bản đầu; báo lỗi thay vì tính bbox gần toàn thế giới.

### 2. Lấy đầy đủ ứng viên trong phạm vi được hỗ trợ

Mở rộng lớp dữ liệu trong `src/db/osmPlaces.ts` theo mẫu truy vấn bbox hiện có, tái sử dụng chuyển đổi row thành `OSMPlace`. Chỉ lấy `placeType = 'building'` và geometry `Polygon` hoặc `MultiPolygon` có bbox giao vùng chọn.

Truy vấn tối đa `candidateLimit + 1` để phát hiện tràn. Không dùng nguyên giới hạn cắt kết quả của `getPlacesByBbox`, không xếp gần tâm rồi cắt danh sách trước khi tính giao. Khi vượt giới hạn, yêu cầu vùng chọn nhỏ hơn thay vì bỏ mất nhà đạt ngưỡng.

### 3. Tính giao và tỷ lệ phủ

Dùng thư viện hình học có hỗ trợ clipping Polygon/MultiPolygon, holes, kiểm tra tính hợp lệ và tính diện tích theo đơn vị mét vuông. Đánh giá các package Turf chuyên biệt khi triển khai; không tự viết thuật toán clipping và không thêm PostGIS/migration cho bản đầu nếu thư viện đáp ứng được giới hạn tải.

Lọc bbox chỉ là bước tìm ứng viên. Với mỗi ứng viên, kiểm tra geometry hợp lệ, tính diện tích tòa nhà và diện tích giao thật. Dùng cùng phương pháp diện tích cho tử và mẫu; không dùng `areaApproxKm2`, diện tích bbox hoặc số độ vuông. Trừ diện tích lỗ, cộng các phần MultiPolygon đúng theo geometry.

Chạm cạnh hoặc chạm đỉnh có diện tích giao bằng 0 nên không được chọn. So sánh tỷ lệ chưa làm tròn bằng điều kiện `coverageRatio >= 0.5`; không làm tròn 49,9% thành 50% trước khi lọc. Sai số số thực nhỏ có thể được chặn về miền [0, 1], nhưng không được che lỗi geometry thực sự.

Không gom các tòa nhà thành một polygon. Không loại các ID OSM khác nhau chỉ vì có geometry gần giống nhau; cần quy tắc dữ liệu riêng nếu muốn xử lý đối tượng trùng.

### 4. Route, lỗi và tài liệu API

Thêm route trong `server.ts`, kiểu dữ liệu trong `server/types.ts`, ví dụ và contract trong `src/components/ApiDocsView.tsx`. Giới hạn body riêng cho route phải được áp dụng trước middleware JSON toàn cục 50 MB nếu cần chặn kích thước trước parse.

Phân biệt input không hợp lệ (400), body quá lớn (413), vùng vượt giới hạn xử lý (422), lỗi dữ liệu hình học nội bộ (500) và DB không khả dụng (503). Không biến lỗi truy vấn hoặc lỗi tính giao thành mảng rỗng. Không trả chi tiết SQL hoặc stack trace cho client.

## Điều kiện dữ liệu trước khi phát hành

Parser relation hiện có rủi ro coi các member way là outer ring, bỏ qua `member.role` và không ráp các fragment. Geometry vẫn có thể trông hợp lệ về mặt cấu trúc nhưng sai footprint thực tế; kiểm tra validity tại request không đủ phát hiện trường hợp này.

Trước khi phát hành, kiểm tra các đường import đang được sử dụng và dữ liệu building relation thực tế. Nếu dữ liệu chịu ảnh hưởng, cần sửa xử lý outer/inner và ráp vòng tại importer, thêm fixture tương ứng, rồi nhập lại các bản ghi bị ảnh hưởng từ nguồn OSM. Giữ dữ liệu cũ hoặc backup để phục hồi trước khi thay thế. Không cam kết tỷ lệ phủ chính xác khi footprint đầu vào chưa đúng.

## Bằng chứng nghiệm thu

1. Nhà nằm hoàn toàn trong vùng chọn đạt tỷ lệ 1; nhà ngoài vùng chọn không được trả về.
2. Fixture diện tích biết trước kiểm tra 49,9% bị loại, 50% và 50,1% được chọn; nhà lớn chỉ bị sượt góc không được chọn chỉ vì diện tích giao tuyệt đối lớn.
3. Hai nhà được phủ ít nhất 50% và một nhà sượt góc dưới 50% chỉ trả hai nhà đầu. Nếu tất cả nhà đều dưới 50%, trả `places: []`, kể cả khi có nhà rất gần vùng chọn.
4. Polygon lõm, vùng chọn nằm trong lỗ và MultiPolygon được tính đúng; giao chỉ tại cạnh/đỉnh không chọn nhà.
5. Kiểm tra tọa độ sai kiểu, ngoài miền, đỉnh trùng, thẳng hàng, tự cắt và vượt giới hạn.
6. Geometry trả về giữ nguyên đường bao tòa nhà; thứ tự kết quả ổn định; không có ID lặp trong cùng response.
7. Kiểm tra repository/route: chỉ lấy building polygon, phát hiện `limit + 1`, phân biệt rỗng với DB lỗi và lỗi geometry.
8. Đo thời gian, số ứng viên và bộ nhớ trên vùng nhà thưa, nhà dày và request sát giới hạn để chốt giới hạn xử lý.
9. Chạy các test mới, `npm run lint` và `npm run build`. Không cần triển khai UI vẽ mới để nghiệm thu API.

## Thứ tự thực hiện

1. Dùng contract và ngưỡng 50% trong kế hoạch này; thiết lập giới hạn xử lý ban đầu để đo và hiệu chỉnh trước khi phát hành.
2. Xác minh chất lượng footprint và chọn dependency hình học phù hợp.
3. Triển khai hàm lựa chọn cùng fixture hình học.
4. Triển khai truy vấn ứng viên có phát hiện tràn và route.
5. Cập nhật tài liệu API, kiểm thử tích hợp và đo vùng đại diện.
6. Xác nhận mọi điều kiện dữ liệu được đáp ứng trước khi phát hành.

Chưa cần ADR: hiện chưa chọn migration hoặc quyết định kiến trúc khó đảo ngược.
